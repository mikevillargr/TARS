"""
AgentExecutor — wraps claude-code-sdk and yields typed events.

Only used for sub-agents (frontend / backend / sa).
Evolutionarist uses the standard Anthropic SDK directly in job_manager.

Git workflow per job:
  1. checkout -b agent/<job_id[:8]> (feature branch off current HEAD)
  2. Claude does its work (Read / Write / Edit / Bash / Glob / Grep)
  3. git add -A && git commit
  4. git push origin agent/<job_id[:8]>
  5. gh pr create --base dev  →  PR URL stored in DB + shown in UI

Typed event schema (all dicts with a "type" field):
  text_chunk        — Claude's streamed text
  thinking          — Claude's reasoning
  tool_start        — file/bash action starting  {"tool": str, "input": dict}
  tool_end          — action result              {"tool": str, "output": str}
  approval_required — destructive cmd detected   {"command": str, "reason": str}
  approval_granted  — user approved              {"command": str}
  approval_rejected — user rejected
  completed         — done                       {"summary": str, "pr_url": str|None}
  error             — agent failed               {"message": str}
"""
import asyncio
import logging
import os
import re
import subprocess
from typing import AsyncGenerator, Optional

from core.config import settings

log = logging.getLogger(__name__)

TARS_REPO = settings.tars_repo_path

# Patterns in bash commands that require explicit human approval
_DESTRUCTIVE_PATTERNS = [
    re.compile(r"\brm\s+-[rRf]{1,3}\b"),
    re.compile(r"git\s+push.*\bmain\b"),
    re.compile(r"git\s+push.*--force"),
    re.compile(r"\bDROP\s+(TABLE|DATABASE)\b", re.IGNORECASE),
    re.compile(r"\bDELETE\b.*\bWHERE\b", re.IGNORECASE),
    re.compile(r"\bTRUNCATE\b", re.IGNORECASE),
]


def _is_destructive(command: str) -> Optional[str]:
    """Return a human-readable reason if the command matches a destructive pattern."""
    for pat in _DESTRUCTIVE_PATTERNS:
        if pat.search(command):
            return f"matches destructive pattern: `{pat.pattern}`"
    return None


def _gh_env() -> dict:
    """Environment for gh CLI and git push — injects GITHUB_TOKEN + ANTHROPIC_API_KEY."""
    env = dict(os.environ)
    if settings.github_token:
        env["GITHUB_TOKEN"] = settings.github_token
        env["GH_TOKEN"] = settings.github_token
    if settings.anthropic_api_key:
        env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key
    return env


async def run(
    *,
    job_id: str,
    instruction: str,
    model: str,
    approval_gate,  # agents.approval.ApprovalGate
    cwd: str = TARS_REPO,
) -> AsyncGenerator[dict, None]:
    """
    Async generator that runs a claude-code-sdk agent and yields typed events.

    Git flow:
      - Creates feature branch agent/<job_id[:8]> before the agent starts.
      - On completion: stages all changes, commits, pushes, creates a PR to dev.
      - No changes → no commit, no PR.
    """
    try:
        from claude_code_sdk import query, ClaudeCodeOptions  # type: ignore
        from claude_code_sdk.types import (  # type: ignore
            AssistantMessage, UserMessage, ResultMessage,
            TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
        )
    except ImportError:
        yield {"type": "error", "message": "claude-code-sdk not installed. Run: pip install claude-code-sdk"}
        return

    # ── 1. Create feature branch ───────────────────────────────────────────────
    branch = await _setup_branch(cwd=cwd, job_id=job_id)
    yield {"type": "text_chunk", "text": f"Working on branch `{branch}`…\n"}

    # ── 2. Run agent ───────────────────────────────────────────────────────────
    extra_env: dict = {}
    if settings.anthropic_api_key:
        extra_env["ANTHROPIC_API_KEY"] = settings.anthropic_api_key

    options = ClaudeCodeOptions(
        model=model,
        cwd=cwd,
        allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permission_mode="acceptEdits",  # never bypassPermissions
        max_turns=50,
        env=extra_env,
    )

    summary_text = ""
    _stop = False

    # Hold an explicit reference to the generator so we can aclose() it from
    # THIS asyncio task (avoids anyio "cancel scope in different task" error).
    _gen = query(prompt=instruction, options=options)

    try:
        async for message in _gen:

            # ── AssistantMessage: text, thinking, tool calls ───────────────
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        if block.text:
                            summary_text += block.text
                            yield {"type": "text_chunk", "text": block.text}

                    elif isinstance(block, ThinkingBlock):
                        if block.thinking:
                            yield {"type": "thinking", "text": block.thinking}

                    elif isinstance(block, ToolUseBlock):
                        tool_name = block.name
                        tool_input = block.input or {}

                        # Approval gate for destructive bash commands
                        if tool_name.lower() == "bash":
                            command = tool_input.get("command", "")
                            reason = _is_destructive(command)
                            if reason:
                                yield {
                                    "type": "approval_required",
                                    "command": command,
                                    "reason": reason,
                                }
                                await approval_gate.event.wait()

                                if not approval_gate.result.get("approved"):
                                    yield {"type": "approval_rejected"}
                                    _stop = True
                                    break

                                modified = approval_gate.result.get("modified_command")
                                if modified:
                                    tool_input = {**tool_input, "command": modified}
                                yield {
                                    "type": "approval_granted",
                                    "command": tool_input.get("command", command),
                                }

                                from agents import approval as _approval_mod
                                _approval_mod.reset(job_id)

                        yield {"type": "tool_start", "tool": tool_name, "input": tool_input}

            # ── UserMessage: tool results come back here ───────────────────
            elif isinstance(message, UserMessage):
                if isinstance(message.content, list):
                    for block in message.content:
                        if isinstance(block, ToolResultBlock):
                            content = block.content or ""
                            if isinstance(content, list):
                                content = "\n".join(
                                    c.get("text", str(c)) if isinstance(c, dict) else str(c)
                                    for c in content
                                )
                            yield {
                                "type": "tool_end",
                                "tool": "",
                                "output": str(content)[:2000],
                                "is_error": block.is_error or False,
                            }

            # ── ResultMessage: final outcome ───────────────────────────────
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    err_text = message.result or "Agent run failed."
                    yield {"type": "error", "message": err_text}
                    _stop = True
                    break
                if message.result:
                    summary_text = message.result

            if _stop:
                break

    except Exception as exc:
        log.exception("Agent executor error for job %s", job_id)
        yield {"type": "error", "message": str(exc)}
        _stop = True

    finally:
        # Explicitly close the SDK generator in THIS task to avoid anyio
        # RuntimeError from GC finalizer running in a different asyncio task.
        try:
            await _gen.aclose()
        except Exception:
            pass

    if _stop:
        # Still try to commit any partial work so nothing is lost
        await _commit_and_push(cwd=cwd, job_id=job_id, branch=branch,
                               summary=summary_text or "Partial work before error.")
        return

    # ── 3. Commit, push, open PR ───────────────────────────────────────────────
    yield {"type": "text_chunk", "text": "\nCommitting and pushing changes…\n"}
    pr_url = await _commit_and_push(cwd=cwd, job_id=job_id, branch=branch,
                                    summary=summary_text or instruction[:120])

    yield {
        "type": "completed",
        "summary": summary_text[:500] if summary_text else "Agent completed.",
        "pr_url": pr_url,
        "branch": branch,
    }


# ── Git helpers ────────────────────────────────────────────────────────────────

async def _run_git(args: list, *, cwd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return await asyncio.to_thread(
        subprocess.run, args,
        cwd=cwd, capture_output=True, text=True, timeout=timeout,
        env=_gh_env(),
    )


async def _setup_branch(*, cwd: str, job_id: str) -> str:
    """
    Create a fresh feature branch off the current HEAD.
    Returns the branch name (falls back to current branch on failure).
    """
    branch = f"agent/{job_id[:8]}"

    # Ensure we're on dev first
    await _run_git(["git", "checkout", "dev"], cwd=cwd)
    await _run_git(["git", "pull", "--ff-only", "origin", "dev"], cwd=cwd)

    result = await _run_git(["git", "checkout", "-b", branch], cwd=cwd)
    if result.returncode != 0:
        log.warning("Branch creation failed for job %s: %s — working on dev", job_id, result.stderr)
        return "dev"
    return branch


async def _commit_and_push(*, cwd: str, job_id: str, branch: str, summary: str) -> Optional[str]:
    """
    Stage all changes, commit, push to origin, open a draft PR to dev.
    Returns PR URL or None.
    """
    # Check for changes
    status = await _run_git(["git", "status", "--porcelain"], cwd=cwd)
    if not status.stdout.strip():
        log.info("No changes to commit for job %s", job_id)
        # If on a feature branch with no changes, just return — nothing to PR
        return None

    # Stage everything
    await _run_git(["git", "add", "-A"], cwd=cwd)

    # Build commit message
    short_summary = summary.strip().split("\n")[0][:72]
    commit_msg = f"agent({job_id[:8]}): {short_summary}"

    commit = await _run_git(["git", "commit", "-m", commit_msg], cwd=cwd)
    if commit.returncode != 0:
        log.warning("Commit failed for job %s: %s", job_id, commit.stderr)
        return None

    log.info("Job %s committed: %s", job_id, commit_msg)

    # Push
    push = await _run_git(["git", "push", "origin", branch], cwd=cwd, timeout=60)
    if push.returncode != 0:
        log.warning("Push failed for job %s: %s", job_id, push.stderr)
        return None

    log.info("Job %s pushed branch %s", job_id, branch)

    # Open PR (only for feature branches, not direct dev commits)
    if branch == "dev":
        return None

    pr_body = (
        f"## Agent Job `{job_id[:8]}`\n\n"
        f"{summary[:800]}\n\n"
        f"---\n*Auto-generated by TARS Evolutionarist agent*"
    )

    pr = await _run_git(
        ["gh", "pr", "create",
         "--base", "dev",
         "--head", branch,
         "--title", commit_msg,
         "--body", pr_body,
         "--draft"],
        cwd=cwd, timeout=30,
    )

    if pr.returncode == 0:
        url = pr.stdout.strip().split("\n")[-1]
        if url.startswith("http"):
            log.info("Job %s PR created: %s", job_id, url)
            return url
        # gh sometimes prints "Creating pull request..." before the URL
        for line in pr.stdout.strip().split("\n"):
            if line.startswith("http"):
                return line

    log.warning("PR creation failed for job %s: %s", job_id, pr.stderr)
    return None
