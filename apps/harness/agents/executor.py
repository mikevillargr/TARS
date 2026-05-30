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
        from claude_code_sdk.types import (  # type: ignore
            AssistantMessage, UserMessage, ResultMessage,
            TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
        )
    except ImportError:
        yield {"type": "error", "message": "claude-code-sdk not installed. Run: pip install claude-code-sdk"}
        return

    # Pass ANTHROPIC_API_KEY via options.env so the claude CLI subprocess gets it.
    # The harness uses TARS_ANTHROPIC_API_KEY (pydantic alias) to avoid collision
    # with Claude Desktop — but the claude CLI expects the standard name.
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

    try:
        async for message in query(prompt=instruction, options=options):

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
                                # Wait for frontend response (blocks this generator)
                                await approval_gate.event.wait()

                                if not approval_gate.result.get("approved"):
                                    yield {"type": "approval_rejected"}
                                    return

                                # Use modified command if provided
                                modified = approval_gate.result.get("modified_command")
                                if modified:
                                    tool_input = {**tool_input, "command": modified}
                                yield {
                                    "type": "approval_granted",
                                    "command": tool_input.get("command", command),
                                }

                                # Reset gate for next approval in this job
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
                                # List of content dicts from tool output
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
                    err_text = message.result or "Agent run failed with unknown error."
                    yield {"type": "error", "message": err_text}
                    return
                if message.result:
                    summary_text = message.result

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
