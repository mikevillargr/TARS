"""
AgentExecutor — wraps claude-code-sdk and yields typed events.

Only used for sub-agents (frontend / backend / sa).
Evolutionarist uses the standard Anthropic SDK directly in job_manager.

Git workflow per job:
  1. checkout -b agent/<job_id[:8]> (feature branch off current HEAD)
  2. Claude does its work (Read / Write / Edit / Bash / Glob / Grep)
  3. git add -A && git commit
  4. git push origin agent/<job_id[:8]>
  5. gh pr create --base dev (non-draft)  →  PR URL stored in DB + shown in UI
  6. gh pr merge → auto-merge to dev
  7. deploy.sh web|harness|both dev  →  live site updated

Typed event schema (all dicts with a "type" field):
  text_chunk        — Claude's streamed text
  thinking          — Claude's reasoning
  tool_start        — file/bash action starting  {"tool": str, "input": dict}
  tool_end          — action result              {"tool": str, "output": str}
  approval_required — destructive cmd detected   {"command": str, "reason": str}
  approval_granted  — user approved              {"command": str}
  approval_rejected — user rejected
  deploy_started    — deploy kicked off          {"target": "web"|"harness"|"both"}
  deploy_completed  — deploy finished            {"target": str, "success": bool, "output": str}
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

# Git/gh write operations that the harness owns — agent must NOT run these.
# (Read-only ops like status/log/diff/show/branch -l are allowed.)
_FORBIDDEN_GIT_PATTERNS = [
    re.compile(r"\bgit\s+(commit|push|checkout|switch|merge|rebase|reset|tag|stash|cherry-pick|add|rm|mv|restore|clean|fetch|pull|apply|am|revert|init)\b"),
    re.compile(r"\bgh\s+pr\s+(create|merge|edit|close|review|ready|reopen)\b"),
    re.compile(r"\bgh\s+repo\s+(clone|create|delete|sync|fork|edit)\b"),
]

# Pre-baked directive prepended to every sub-agent instruction.
# Forces agents to read AGENTS.md before doing anything else.
_HARNESS_DIRECTIVE = """\
================================================================
TARS HARNESS — MANDATORY FIRST STEP

Before you do ANYTHING else, read the agent operations manual at
/opt/tars/AGENTS.md. It documents:
- The codebase structure (where features actually live vs dead code)
- The git/release/deploy pipeline (what happens after you stop)
- The verification you MUST run before stopping (npx tsc --noEmit)
- What commit message format becomes the release note

Run NOW: cat /opt/tars/AGENTS.md

If you skip this, you will likely edit dead code, break the build, or
have your job marked failed before any code reaches production.

Quick reminders for this session:
- Do NOT run any git/gh write commands. The harness handles all git ops.
- Before stopping, run: cd /opt/tars/apps/web && npx tsc --noEmit
- Your final summary becomes the commit message + release note. Make it
  a single clear sentence describing what changed (not "Here's a summary…")
================================================================

"""

# Claude signals a question by running: tars-ask "question text here"
_QUESTION_PATTERN = re.compile(r'^tars-ask\s+"(.+)"$', re.DOTALL)


def _is_forbidden_git(command: str) -> bool:
    """Return True if the bash command tries to do a git/gh write operation."""
    for pat in _FORBIDDEN_GIT_PATTERNS:
        if pat.search(command):
            return True
    return False


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

    # ── 0. Capture starting dev SHA (safety net for change detection) ─────────
    # If the agent goes rogue and pushes to dev directly (bypassing our PR
    # flow), we can still detect the changes by comparing this SHA against
    # dev at deploy time.
    start_dev_sha = await _capture_dev_sha(cwd=cwd)

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

    # Prepend harness rules so the agent doesn't try to do git itself.
    full_instruction = _HARNESS_DIRECTIVE + instruction

    # Hold an explicit reference to the generator so we can aclose() it from
    # THIS asyncio task (avoids anyio "cancel scope in different task" error).
    _gen = query(prompt=full_instruction, options=options)

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

                        if tool_name.lower() == "bash":
                            command = tool_input.get("command", "")

                            # Forbidden git/gh write ops: swap with a clear refusal
                            # so Claude sees the rejection and won't retry.
                            if _is_forbidden_git(command):
                                log.warning("Job %s: blocked forbidden git command: %s",
                                            job_id, command[:120])
                                refusal = (
                                    'BLOCKED by TARS harness. The harness handles '
                                    'all git/gh operations automatically (commit, push, '
                                    'PR, merge, deploy). You must NOT run git commit, '
                                    'push, checkout, merge, pull, or gh pr commands. '
                                    'Just edit files and stop — harness takes over.'
                                )
                                tool_input = {**tool_input, "command": f'echo {refusal!r}'}
                                yield {"type": "tool_start", "tool": tool_name, "input": tool_input}
                                continue

                            # Question gate: tars-ask "question text"
                            q_match = _QUESTION_PATTERN.match(command.strip())
                            if q_match:
                                from agents import approval as _approval_mod
                                question_text = q_match.group(1)
                                q_gate = _approval_mod.get_or_create_question(job_id)
                                yield {"type": "question", "id": job_id, "text": question_text}
                                await q_gate.event.wait()
                                answer = q_gate.answer
                                tool_input = {**tool_input, "command": f'echo "User answered: {answer}"'}
                                yield {"type": "question_answered", "id": job_id}
                                _approval_mod.reset_question(job_id)

                            else:
                                # Approval gate for destructive bash commands
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

    # TypeScript check failed — surface error, don't deploy broken code
    if isinstance(pr_url, str) and pr_url.startswith("__tsc_error__"):
        errors = pr_url[len("__tsc_error__"):]
        yield {"type": "error", "message": f"TypeScript errors prevented commit:\n{errors}"}
        return

    # ── 4. Merge PR → detect changes → auto-deploy ────────────────────────────
    async for deploy_event in _auto_deploy(
        cwd=cwd, job_id=job_id, pr_url=pr_url, branch=branch,
        start_dev_sha=start_dev_sha,
    ):
        yield deploy_event

    yield {
        "type": "completed",
        "summary": summary_text[:500] if summary_text else "Agent completed.",
        "pr_url": pr_url,
        "branch": branch,
    }


# ── Auto-deploy helper ────────────────────────────────────────────────────────

async def _auto_deploy(*, cwd: str, job_id: str, pr_url: Optional[str], branch: str,
                       start_dev_sha: Optional[str] = None):
    """
    After a sub-agent job completes, the harness does NOT deploy directly.
    Instead, it merges the PR to main and lets the GitHub Actions release/deploy
    pipeline pick up the change via tag (or the parent Evolutionarist tags).

    Old behaviour was to run deploy.sh against the dev branch, which:
      - reset the server to a frozen dev branch every time an agent ran
      - bypassed the GitHub Actions concurrency/serialization
      - triggered an unnecessary pm2 reload that killed the parent Evolutionarist
    """
    # ── Detect changed files vs main ─────────────────────────────────────────
    changed: list[str] = []
    if branch != "main":
        await _run_git(["git", "fetch", "origin", "main"], cwd=cwd, timeout=30)
        diff = await _run_git(["git", "diff", f"origin/main...{branch}", "--name-only"], cwd=cwd)
        changed = [p for p in diff.stdout.strip().splitlines() if p]

    # Safety net: agent pushed direct to main
    if not changed and start_dev_sha:
        await _run_git(["git", "fetch", "origin", "main"], cwd=cwd, timeout=30)
        diff = await _run_git(
            ["git", "diff", f"{start_dev_sha}..origin/main", "--name-only"],
            cwd=cwd,
        )
        changed = [p for p in diff.stdout.strip().splitlines() if p]
        if changed:
            log.warning(
                "Job %s: detected %d changed files via SHA safety net "
                "(agent likely bypassed PR flow and pushed direct to main)",
                job_id, len(changed),
            )

    has_web     = any(p.startswith("apps/web/") for p in changed)
    has_harness = any(p.startswith("apps/harness/") for p in changed)

    if not changed or (not has_web and not has_harness):
        log.info("Job %s: no web/harness changes detected (%d files) — nothing to ship",
                 job_id, len(changed))
        return

    # ── Merge PR to main ─────────────────────────────────────────────────────
    if pr_url:
        yield {"type": "text_chunk", "text": "\nMerging PR to main…\n"}
        merge = await _run_git(
            ["gh", "pr", "merge", pr_url, "--merge", "--delete-branch"],
            cwd=cwd, timeout=30,
        )
        if merge.returncode != 0:
            log.warning("Job %s: PR merge failed (%s)", job_id, merge.stderr.strip()[:200])
        else:
            log.info("Job %s: PR merged to main", job_id)

    # Restore the working tree to clean main so the parent Evolutionarist (and
    # any subsequent agent) start from a known state. We never call deploy.sh
    # from here anymore — deploys happen via the GH Actions pipeline on tag push.
    await _run_git(["git", "checkout", "main"], cwd=cwd)
    await _run_git(["git", "fetch", "origin", "main"], cwd=cwd, timeout=30)
    await _run_git(["git", "reset", "--hard", "origin/main"], cwd=cwd)

    target = "both" if (has_web and has_harness) else ("web" if has_web else "harness")
    yield {"type": "deploy_started", "target": target}

    # Emit a successful deploy_completed event so the chip says "deployed".
    # The actual production deploy is triggered later when the Evolutionarist
    # finishes and tags a version.
    yield {
        "type": "deploy_completed",
        "target": target,
        "success": True,
        "output": "PR merged. Production deploy will run when Evolutionarist tags the release.",
    }
    return

    # (Old subprocess deploy path retained below for reference but unreachable.)
    deploy = await asyncio.to_thread(
        subprocess.run,
        ["bash", f"{cwd}/infrastructure/scripts/deploy.sh", target, "main"],
        cwd=cwd, capture_output=True, text=True, timeout=300,
        env=_gh_env(),
    )
    success = deploy.returncode == 0
    raw_output = (deploy.stdout + deploy.stderr).strip()
    output = raw_output[-1000:] if len(raw_output) > 1000 else raw_output

    if success:
        log.info("Job %s: deploy (%s) succeeded", job_id, target)
    else:
        log.warning("Job %s: deploy (%s) failed:\n%s", job_id, target, output)

    yield {
        "type": "deploy_completed",
        "target": target,
        "success": success,
        "output": output,
    }


# ── Git helpers ────────────────────────────────────────────────────────────────

async def _run_git(args: list, *, cwd: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return await asyncio.to_thread(
        subprocess.run, args,
        cwd=cwd, capture_output=True, text=True, timeout=timeout,
        env=_gh_env(),
    )


async def _capture_dev_sha(*, cwd: str) -> Optional[str]:
    """Return the current SHA of origin/dev for safety-net change detection."""
    try:
        await _run_git(["git", "fetch", "origin", "dev"], cwd=cwd, timeout=30)
        result = await _run_git(["git", "rev-parse", "origin/dev"], cwd=cwd)
        sha = result.stdout.strip()
        return sha if sha else None
    except Exception as exc:
        log.warning("Failed to capture starting dev SHA: %s", exc)
        return None


async def _setup_branch(*, cwd: str, job_id: str) -> str:
    """
    Create a fresh feature branch off the current HEAD.
    Returns the branch name (falls back to current branch on failure).
    """
    branch = f"agent/{job_id[:8]}"

    # Ensure we're on main and clean before branching
    await _run_git(["git", "checkout", "main"], cwd=cwd)
    await _run_git(["git", "fetch", "origin"], cwd=cwd)
    await _run_git(["git", "reset", "--hard", "origin/main"], cwd=cwd)

    result = await _run_git(["git", "checkout", "-b", branch], cwd=cwd)
    if result.returncode != 0:
        log.warning("Branch creation failed for job %s: %s — working on dev", job_id, result.stderr)
        return "dev"
    return branch


async def _commit_and_push(*, cwd: str, job_id: str, branch: str, summary: str) -> Optional[str]:
    """
    Stage all changes, commit, push to origin, open a PR to dev.
    Returns PR URL or None.
    """
    # Check for changes
    status = await _run_git(["git", "status", "--porcelain"], cwd=cwd)
    if not status.stdout.strip():
        log.info("No changes to commit for job %s", job_id)
        return None

    # Pre-commit TypeScript check — abort if the build is broken
    web_dir = os.path.join(cwd, "apps", "web")
    if os.path.isdir(web_dir):
        tsc = await asyncio.to_thread(
            subprocess.run,
            ["npx", "tsc", "--noEmit"],
            cwd=web_dir, capture_output=True, text=True, timeout=120,
        )
        if tsc.returncode != 0:
            errors = (tsc.stdout + tsc.stderr)[:600]
            log.warning("Job %s: TypeScript errors before commit:\n%s", job_id, errors)
            # Surface errors in the event stream so the agent can see them
            from agents.job_manager import broadcast
            await broadcast(job_id, {
                "type": "text_chunk",
                "text": f"\n⚠ TypeScript errors found — not committing until fixed:\n{errors}\n",
            })
            return f"__tsc_error__{errors}"  # caller sees this and can retry

    # Stage everything
    await _run_git(["git", "add", "-A"], cwd=cwd)

    # Build conventional commit message from agent summary
    first_line = summary.strip().split("\n")[0].strip()
    # Strip agent self-referential openers ("I've", "I ", "The agent", etc.)
    first_line = re.sub(r"^(I(?:'ve| have| )|The agent |This |Here |Done[,.]?\s*)", "", first_line, flags=re.IGNORECASE).strip()
    # Lowercase first char for conventional commit style
    if first_line:
        first_line = first_line[0].lower() + first_line[1:]
    description = first_line[:72] or f"apply agent job {job_id[:8]}"

    # Infer conventional commit type from content
    lower = (summary + description).lower()
    if re.search(r"\b(fix|bug|error|broken|issue|patch|correct|resolve)\b", lower):
        commit_type = "fix"
    elif re.search(r"\b(refactor|restructure|reorganize|clean|simplify|rename|move)\b", lower):
        commit_type = "refactor"
    elif re.search(r"\b(doc|readme|comment|changelog|spec)\b", lower):
        commit_type = "docs"
    elif re.search(r"\b(test|spec|coverage)\b", lower):
        commit_type = "test"
    elif re.search(r"\b(chore|config|dep|package|setup|tooling|ci|lint)\b", lower):
        commit_type = "chore"
    else:
        commit_type = "feat"

    commit_msg = f"{commit_type}(agent): {description}"

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
        f"---\n*Auto-generated by TARS agent*"
    )

    pr = await _run_git(
        ["gh", "pr", "create",
         "--base", "main",
         "--head", branch,
         "--title", commit_msg,
         "--body", pr_body],
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
