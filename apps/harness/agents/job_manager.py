"""
JobManager — spawns agent jobs, manages lifecycle, broadcasts events,
and maintains a ring buffer for reconnecting subscribers.

Sub-agents (frontend / backend / sa):
  Use claude-code-sdk via agents.executor.run().

Release jobs:
  Use agents.release.run() for VPS-side git operations.
"""
import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Callable, Optional, Any

from core.config import settings

log = logging.getLogger(__name__)

TARS_REPO = settings.tars_repo_path

DEFAULT_MODELS: dict[str, str] = {
    "frontend": "claude-sonnet-4-6",
    "backend":  "claude-sonnet-4-6",
    "sa":       "claude-opus-4-5",
    "release":  "claude-sonnet-4-6",
}

# ── In-memory state ────────────────────────────────────────────────────────────

# job_id -> set of send_fn callables (one per connected WS subscriber)
_subscribers: dict[str, set[Callable]] = {}

# job_id -> deque of last 200 events (ring buffer for reconnect/page refresh)
_buffers: dict[str, deque] = {}

# job_id -> running asyncio.Task
_tasks: dict[str, asyncio.Task] = {}

# Set by lifespan() during shutdown so CancelledError handlers leave the
# DB row as "pending" (already set by the shutdown handler) instead of
# stamping "cancelled" and breaking the re-queue path.
_shutdown_requested: bool = False


# ── Public API ─────────────────────────────────────────────────────────────────

async def start_job(job_id: str, db_session_factory: Any) -> None:
    """
    Spawn an agent job as a background asyncio task.
    db_session_factory is a callable that returns an AsyncSession context manager.
    """
    task = asyncio.create_task(_run_job(job_id, db_session_factory))
    _tasks[job_id] = task
    task.add_done_callback(lambda t: _tasks.pop(job_id, None))


def subscribe(job_id: str, send_fn: Callable) -> None:
    _subscribers.setdefault(job_id, set()).add(send_fn)
    # Replay buffered events to the new subscriber immediately
    asyncio.create_task(_replay_buffer(job_id, send_fn))


def unsubscribe(job_id: str, send_fn: Callable) -> None:
    _subscribers.get(job_id, set()).discard(send_fn)


async def broadcast(job_id: str, event: dict) -> None:
    buf = _buffers.setdefault(job_id, deque(maxlen=200))
    buf.append(event)
    dead: set = set()
    for send_fn in list(_subscribers.get(job_id, set())):
        try:
            await send_fn(event)
        except Exception:
            dead.add(send_fn)
    if dead:
        _subscribers.get(job_id, set()).difference_update(dead)


def cancel_job(job_id: str) -> None:
    task = _tasks.get(job_id)
    if task:
        task.cancel()


# ── Internal helpers ───────────────────────────────────────────────────────────

async def _replay_buffer(job_id: str, send_fn: Callable) -> None:
    for event in list(_buffers.get(job_id, [])):
        try:
            await send_fn(event)
        except Exception:
            return


async def _run_job(job_id: str, db_session_factory: Any) -> None:
    from agents import approval as _approval
    from db.models import AgentJob

    async with db_session_factory() as db:
        from sqlalchemy import select
        row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
        if not row:
            log.error("Job %s not found", job_id)
            return

        # Mark running
        row.status = "running"
        row.started_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(row)

        agent_type = row.agent_type
        instruction = row.instruction
        model_cfg = row.model_config_json or {}
        model = model_cfg.get(agent_type) or DEFAULT_MODELS.get(agent_type, "claude-sonnet-4-6")

    try:
        if agent_type == "release":
            await _run_release(job_id, instruction, db_session_factory)
        else:
            await _run_subagent(job_id, instruction, model, agent_type, db_session_factory)

        # Mark completed
        async with db_session_factory() as db:
            from sqlalchemy import select
            row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if row and row.status not in ("failed", "cancelled"):
                row.status = "completed"
                row.completed_at = datetime.now(timezone.utc)
                await db.commit()

    except asyncio.CancelledError:
        # If this CancelledError came from harness shutdown (not user action),
        # lifespan already marked the row as "pending" — leave it for re-queue.
        if _shutdown_requested:
            log.info("Job %s cancelled by shutdown — left pending for next start", job_id)
            raise
        async with db_session_factory() as db:
            from sqlalchemy import select
            row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if row and row.status != "pending":
                row.status = "cancelled"
                row.completed_at = datetime.now(timezone.utc)
                await db.commit()
        await broadcast(job_id, {"type": "agent_stopped", "reason": "Cancelled by user"})

    except Exception as exc:
        log.exception("Job %s failed", job_id)
        async with db_session_factory() as db:
            from sqlalchemy import select
            row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if row:
                row.status = "failed"
                row.completed_at = datetime.now(timezone.utc)
                row.output = str(exc)
                await db.commit()
        await broadcast(job_id, {"type": "error", "message": str(exc)})

    finally:
        _approval.cleanup(job_id)
        _approval.cleanup_question(job_id)
        # Schedule buffer cleanup in 5 min
        asyncio.create_task(_cleanup_buffer_later(job_id, delay=300))


async def _notify_chat(job_id: str, message: str, db_session_factory: Any) -> None:
    """Insert a TARS assistant message and push a real-time notification."""
    try:
        async with db_session_factory() as db:
            from sqlalchemy import select
            from db.models import AgentJob, Message
            job = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if not job or not job.conversation_id:
                return
            msg = Message(
                conversation_id=job.conversation_id,
                role="assistant",
                content=message,
                model_used="system",
            )
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            log.info("Job %s: notified chat conversation %s", job_id, job.conversation_id)

            # Push real-time notification so the chat page updates without polling
            from agents.notifications import publish as _notify_publish
            await _notify_publish(job.user_id, {
                "type": "new_message",
                "conversation_id": job.conversation_id,
                "message_id": msg.id,
                "preview": message[:120],
                "created_at": msg.created_at.isoformat(),
            })
    except Exception as exc:
        log.warning("Job %s: failed to notify chat: %s", job_id, exc)


async def _run_subagent(
    job_id: str,
    instruction: str,
    model: str,
    agent_type: str,
    db_session_factory: Any,
) -> None:
    from agents import approval as _approval, executor as _executor
    gate = _approval.get_or_create(job_id)

    _deploy_result: Optional[dict] = None  # track deploy outcome for chat notification

    async for event in _executor.run(
        job_id=job_id,
        instruction=instruction,
        model=model,
        approval_gate=gate,
    ):
        # Update status to awaiting_approval when gate fires
        if event["type"] == "approval_required":
            async with db_session_factory() as db:
                from sqlalchemy import select
                from db.models import AgentJob
                row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
                if row:
                    row.status = "awaiting_approval"
                    row.approval_prompt = event.get("command", "")
                    await db.commit()

        elif event["type"] in ("approval_granted", "approval_rejected"):
            async with db_session_factory() as db:
                from sqlalchemy import select
                from db.models import AgentJob
                row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
                if row and row.status == "awaiting_approval":
                    row.status = "running" if event["type"] == "approval_granted" else "failed"
                    await db.commit()

        elif event["type"] == "deploy_completed":
            _deploy_result = event

        elif event["type"] == "completed":
            summary = event.get("summary", "")
            async with db_session_factory() as db:
                from sqlalchemy import select
                from db.models import AgentJob
                row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
                if row:
                    if event.get("pr_url"):
                        row.pr_url = event["pr_url"]
                    if event.get("branch"):
                        row.branch = event["branch"]
                    row.output = summary
                    row.status = "completed"
                    row.completed_at = datetime.now(timezone.utc)
                    await db.commit()

            # Notify the originating chat conversation
            pr_url = event.get("pr_url")
            first_line = summary.split("\n")[0].strip()[:300] if summary else "Done"
            if _deploy_result and not _deploy_result.get("success"):
                notify_msg = f"{first_line} Deploy failed — check Agent Jobs."
            elif pr_url:
                notify_msg = f"{first_line} PR: {pr_url}"
            else:
                notify_msg = first_line
            await _notify_chat(job_id, notify_msg, db_session_factory)

        await broadcast(job_id, event)

        if event["type"] in ("approval_rejected", "error"):
            return


async def _auto_patch_release(job_id: str, db_session_factory: Any) -> Optional[str]:
    """
    Increment the latest semver patch tag, push it, and return the new version string.
    Returns None if tagging fails (non-fatal).
    """
    import subprocess as sp
    try:
        latest = (await asyncio.to_thread(
            sp.run, ["git", "describe", "--tags", "--abbrev=0"],
            cwd=TARS_REPO, capture_output=True, text=True, timeout=15,
        )).stdout.strip()

        import re
        m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", latest)
        if not m:
            return None
        major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
        new_tag = f"v{major}.{minor}.{patch + 1}"

        for cmd in [
            ["git", "tag", new_tag],
            ["git", "push", "origin", new_tag],
        ]:
            r = await asyncio.to_thread(
                sp.run, cmd, cwd=TARS_REPO, capture_output=True, text=True, timeout=30,
            )
            if r.returncode != 0:
                log.warning("Auto-release tag step failed: %s", r.stderr)
                return None

        log.info("Job %s: auto-released %s", job_id, new_tag)
        return new_tag
    except Exception as exc:
        log.warning("Job %s: auto-release failed: %s", job_id, exc)
        return None


async def _run_release(
    job_id: str,
    instruction: str,
    db_session_factory: Any,
) -> None:
    """
    Release job: gather changes, draft release notes via Sonnet,
    emit release_approval card, then execute git operations on approval.
    """
    import subprocess as sp

    await broadcast(job_id, {"type": "text_chunk", "text": "Gathering changes since last release...\n"})

    # Gather git log
    try:
        log_result = await asyncio.to_thread(
            sp.run,
            ["git", "log", "main..dev", "--oneline", "--no-merges"],
            cwd=TARS_REPO, capture_output=True, text=True, timeout=15,
        )
        commits = log_result.stdout.strip() or "No commits ahead of main."
        diff_stat = (await asyncio.to_thread(
            sp.run,
            ["git", "diff", "--stat", "main..dev"],
            cwd=TARS_REPO, capture_output=True, text=True, timeout=15,
        )).stdout.strip()
    except Exception as exc:
        await broadcast(job_id, {"type": "error", "message": f"Failed to read git history: {exc}"})
        return

    # Draft release notes — use tier3 provider (respects Settings config)
    from core.model_client import get_model_client as _get_mc2
    _mc2 = _get_mc2()
    _p = settings.tier3_provider
    client = _mc2.zai if _p == "zai" else _mc2.anthropic
    _release_model = settings.tier3_model_override or ("glm-4.7" if _p == "zai" else "claude-sonnet-4-6")
    draft_prompt = (
        f"Draft release notes for a TARS personal AI system update.\n\n"
        f"Commits:\n{commits}\n\nDiff stat:\n{diff_stat}\n\n"
        "Suggest a semver version (PATCH/MINOR/MAJOR) and write concise release notes "
        "(3–8 bullet points). Format as JSON: "
        '{"version": "X.Y.Z", "notes": ["...", ...]}'
    )

    await broadcast(job_id, {"type": "text_chunk", "text": "Drafting release notes...\n"})
    resp = await client.messages.create(
        model=_release_model,
        max_tokens=512,
        messages=[{"role": "user", "content": draft_prompt}],
    )
    raw_notes = resp.content[0].text if resp.content else "{}"

    import json, re
    try:
        m = re.search(r"\{.*\}", raw_notes, re.DOTALL)
        parsed = json.loads(m.group()) if m else {}
    except Exception:
        parsed = {}

    version = parsed.get("version", "0.0.1")
    notes = parsed.get("notes", [commits])

    # Emit release approval card — frontend renders this as a blocking modal
    from agents import approval as _approval
    gate = _approval.get_or_create(job_id)

    await broadcast(job_id, {
        "type": "release_approval",
        "version": version,
        "notes": notes,
        "commits": commits,
        "diff_stat": diff_stat,
    })

    # Update DB status
    async with db_session_factory() as db:
        from sqlalchemy import select
        from db.models import AgentJob
        row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
        if row:
            row.status = "awaiting_approval"
            row.approval_prompt = f"Release v{version}"
            await db.commit()

    await gate.event.wait()

    if not gate.result.get("approved"):
        await broadcast(job_id, {"type": "approval_rejected"})
        async with db_session_factory() as db:
            from sqlalchemy import select
            from db.models import AgentJob
            row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if row:
                row.status = "cancelled"
                row.completed_at = datetime.now(timezone.utc)
                await db.commit()
        return

    await broadcast(job_id, {"type": "approval_granted", "command": f"release v{version}"})

    # Execute release git operations on VPS
    async with db_session_factory() as db:
        from sqlalchemy import select
        from db.models import AgentJob
        row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
        if row:
            row.status = "running"
            await db.commit()

    cmds = [
        ["git", "checkout", "main"],
        ["git", "merge", "dev", "--no-ff", "-m", f"release: v{version}"],
        ["git", "tag", "-a", f"v{version}", "-m", f"Release v{version}"],
        ["git", "push", "origin", "main", "--tags"],
        ["git", "checkout", "dev"],
        ["git", "merge", "main"],
        ["git", "push", "origin", "dev"],
    ]

    for cmd in cmds:
        cmd_str = " ".join(cmd)
        await broadcast(job_id, {"type": "tool_start", "tool": "Bash", "input": {"command": cmd_str}})
        result = await asyncio.to_thread(
            sp.run, cmd, cwd=TARS_REPO, capture_output=True, text=True, timeout=60,
        )
        output = (result.stdout + result.stderr).strip()
        await broadcast(job_id, {"type": "tool_end", "tool": "Bash", "output": output})
        if result.returncode != 0:
            await broadcast(job_id, {"type": "error", "message": f"Release step failed: {cmd_str}\n{output}"})
            async with db_session_factory() as db:
                from sqlalchemy import select
                from db.models import AgentJob
                row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
                if row:
                    row.status = "failed"
                    row.completed_at = datetime.now(timezone.utc)
                    await db.commit()
            return

    await broadcast(job_id, {
        "type": "completed",
        "summary": f"v{version} released to main and pushed. GitHub Actions deploying...",
        "pr_url": None,
        "version": version,
    })


async def _cleanup_buffer_later(job_id: str, delay: int) -> None:
    await asyncio.sleep(delay)
    _buffers.pop(job_id, None)
    _subscribers.pop(job_id, None)
