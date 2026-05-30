"""
AgentExecutor — wraps claude-code-sdk and yields typed events.

Only used for sub-agents (frontend / backend / sa / release).
Evolutionarist uses the standard Anthropic SDK directly in job_manager.

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
    Caller is responsible for catching StopAsyncIteration.
    """
    try:
        from claude_code_sdk import query, ClaudeCodeOptions  # type: ignore
    except ImportError:
        yield {"type": "error", "message": "claude-code-sdk not installed. Run: pip install claude-code-sdk"}
        return

    options = ClaudeCodeOptions(
        model=model,
        cwd=cwd,
        allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        permission_mode="acceptEdits",  # never bypassPermissions
        max_turns=50,
    )

    pr_url: Optional[str] = None
    summary_text = ""

    try:
        async for event in query(prompt=instruction, options=options):
            etype = getattr(event, "type", None) or type(event).__name__.lower()

            # ── Assistant text / thinking ──────────────────────────────────
            if etype in ("assistant", "text"):
                text = getattr(event, "text", None) or ""
                if text:
                    yield {"type": "text_chunk", "text": text}
                    summary_text += text

            # ── Tool use ──────────────────────────────────────────────────
            elif etype == "tool_use":
                tool_name = getattr(event, "name", "")
                tool_input = getattr(event, "input", {}) or {}

                # Approval gate for bash commands
                if tool_name.lower() == "bash":
                    command = tool_input.get("command", "")
                    reason = _is_destructive(command)
                    if reason:
                        yield {
                            "type": "approval_required",
                            "command": command,
                            "reason": reason,
                        }
                        # Wait for frontend response (blocks this generator)
                        await approval_gate.event.wait()

                        if not approval_gate.result.get("approved"):
                            yield {"type": "approval_rejected"}
                            return

                        # Use modified command if provided
                        modified = approval_gate.result.get("modified_command")
                        if modified:
                            tool_input = {**tool_input, "command": modified}
                        yield {"type": "approval_granted", "command": tool_input.get("command", command)}

                        # Reset gate for next approval request in this job
                        from agents import approval as _approval_mod
                        _approval_mod.reset(job_id)

                yield {"type": "tool_start", "tool": tool_name, "input": tool_input}

            # ── Tool result ────────────────────────────────────────────────
            elif etype == "tool_result":
                tool_name = getattr(event, "name", "")
                output = getattr(event, "output", "") or ""
                yield {"type": "tool_end", "tool": tool_name, "output": str(output)[:2000]}

            # ── Result / completion ───────────────────────────────────────
            elif etype == "result":
                output = getattr(event, "output", "") or ""
                if output:
                    summary_text = output

    except Exception as exc:
        log.exception("Agent executor error for job %s", job_id)
        yield {"type": "error", "message": str(exc)}
        return

    # Attempt to create a PR after successful completion
    pr_url = await _create_pr(cwd=cwd, job_id=job_id)

    yield {
        "type": "completed",
        "summary": summary_text[:500] if summary_text else "Agent completed.",
        "pr_url": pr_url,
    }


async def _create_pr(*, cwd: str, job_id: str) -> Optional[str]:
    """Create a PR from current branch to dev using gh CLI. Returns PR URL or None."""
    try:
        result = await asyncio.to_thread(
            subprocess.run,
            [
                "gh", "pr", "create",
                "--base", "dev",
                "--fill",
                "--draft",
            ],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            url = result.stdout.strip().split("\n")[-1]
            if url.startswith("http"):
                return url
        else:
            log.warning("gh pr create failed for job %s: %s", job_id, result.stderr)
    except Exception as exc:
        log.warning("PR creation failed for job %s: %s", job_id, exc)
    return None
