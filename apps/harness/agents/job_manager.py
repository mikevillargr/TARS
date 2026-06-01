"""
JobManager — spawns agent jobs, manages lifecycle, broadcasts events,
and maintains a ring buffer for reconnecting subscribers.

Evolutionarist (orchestrator):
  Uses the Anthropic SDK with a spawn_agent tool. On tool call it creates
  a child AgentJob row and starts the appropriate sub-agent executor.

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

import anthropic

from core.config import settings

log = logging.getLogger(__name__)

TARS_REPO = settings.tars_repo_path

DEFAULT_MODELS: dict[str, str] = {
    "evolutionarist": "claude-sonnet-4-6",
    "frontend":       "claude-sonnet-4-6",
    "backend":        "claude-sonnet-4-6",
    "sa":             "claude-opus-4-5",
    "release":        "claude-sonnet-4-6",
}

EVOLUTIONARIST_SYSTEM = f"""\
You are Evolutionarist, the TARS orchestration agent. You work exclusively on \
the TARS codebase at {TARS_REPO} on the main branch.

Analyze the task and decide which specialist(s) to spawn:
- frontend: UI, React components, Next.js pages, CSS/styling
- backend: FastAPI routes, DB models, Python services, integrations
- sa (solutions architect): cross-cutting concerns, schema design, multi-layer features

Use the spawn_agent tool to delegate. Provide each sub-agent a precise, scoped instruction
that includes the repo path {TARS_REPO} explicitly.
You may spawn multiple agents sequentially or in parallel batches.
After ALL sub-agents have completed, summarise what was done — the harness will
automatically tag a release and deploy.

SAFETY RULES:
- Never --force push. Work on feature branches off main only.
- The codebase is at {TARS_REPO} — always use this exact path.
"""

SPAWN_AGENT_TOOL: dict = {
    "name": "spawn_agent",
    "description": "Spawn a specialist sub-agent to execute a scoped task on the TARS codebase.",
    "input_schema": {
        "type": "object",
        "properties": {
            "agent_type": {
                "type": "string",
                "enum": ["frontend", "backend", "sa"],
                "description": "Specialist type to spawn",
            },
            "instruction": {
                "type": "string",
                "description": "Precise, scoped task instruction for the sub-agent",
            },
        },
        "required": ["agent_type", "instruction"],
    },
}

# ── In-memory state ────────────────────────────────────────────────────────────

# job_id -> set of send_fn callables (one per connected WS subscriber)
_subscribers: dict[str, set[Callable]] = {}

# job_id -> deque of last 200 events (ring buffer for reconnect/page refresh)
_buffers: dict[str, deque] = {}

# job_id -> running asyncio.Task
_tasks: dict[str, asyncio.Task] = {}


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
        if agent_type == "evolutionarist":
            await _run_evolutionarist(job_id, instruction, model, db_session_factory)
        elif agent_type == "release":
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
        async with db_session_factory() as db:
            from sqlalchemy import select
            row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
            if row:
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
    """Insert a TARS assistant message into the originating conversation."""
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
            log.info("Job %s: notified chat conversation %s", job_id, job.conversation_id)
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

            # SA agents: if this is a root SA job (no parent), auto-escalate to Evolutionarist
            # so findings get actioned — not just reported.
            if agent_type == "sa":
                async with db_session_factory() as db:
                    from sqlalchemy import select
                    from db.models import AgentJob
                    row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
                    if row and row.parent_job_id is None and summary:
                        escalation_instruction = (
                            f"An SA agent investigated the following task and produced findings. "
                            f"Now implement all fixes described in the findings.\n\n"
                            f"Original task: {instruction[:300]}\n\n"
                            f"SA findings:\n{summary[:1500]}\n\n"
                            f"Spawn the appropriate frontend and/or backend agents to implement every fix."
                        )
                        evo_job_id = await _create_sub_job(
                            parent_job_id=job_id,
                            agent_type="evolutionarist",
                            instruction=escalation_instruction,
                            db_session_factory=db_session_factory,
                        )
                        asyncio.create_task(_run_evolutionarist(
                            evo_job_id, escalation_instruction,
                            DEFAULT_MODELS["evolutionarist"], db_session_factory,
                        ))
                        await _notify_chat(
                            job_id,
                            f"🔍 SA investigation complete — escalating to implementation agents…",
                            db_session_factory,
                        )
                        await broadcast(job_id, event)
                        return

            # Notify the originating chat conversation
            pr_url = event.get("pr_url")
            if _deploy_result:
                if _deploy_result.get("success"):
                    notify_msg = f"✅ Agent job deployed ({_deploy_result['target']})."
                    if pr_url:
                        notify_msg += f" PR: {pr_url}"
                else:
                    notify_msg = (
                        f"⚠️ Agent job finished but deploy failed ({_deploy_result['target']}). "
                        "Check Agent Jobs for details."
                    )
            else:
                notify_msg = "✅ Agent job completed."
                if pr_url:
                    notify_msg += f" PR: {pr_url}"
            await _notify_chat(job_id, notify_msg, db_session_factory)

        await broadcast(job_id, event)

        if event["type"] in ("approval_rejected", "error"):
            return


async def _run_evolutionarist(
    job_id: str,
    instruction: str,
    model: str,
    db_session_factory: Any,
) -> None:
    """
    Run the Evolutionarist orchestrator using the Anthropic SDK.
    On spawn_agent tool call, create + start a sub-job.
    """
    # Inject memory context into system prompt
    system_prompt = EVOLUTIONARIST_SYSTEM
    try:
        async with db_session_factory() as _mem_db:
            from sqlalchemy import select as _sel
            from db.models import AgentJob as _AgentJob
            _job = (await _mem_db.execute(_sel(_AgentJob).where(_AgentJob.id == job_id))).scalar_one_or_none()
            if _job:
                from memory import mnemon as _mnemon
                memory_context = await _mnemon.search(_mem_db, _job.user_id, instruction, limit=20)
                if memory_context:
                    context_str = "\n".join([m.content for m in memory_context])
                    system_prompt = f"Relevant memory context:\n{context_str}\n\n{system_prompt}"
    except Exception:
        pass  # Memory injection is non-blocking

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    messages = [{"role": "user", "content": instruction}]

    # Notify chat that orchestration is starting
    brief = instruction.strip()[:120]
    await _notify_chat(job_id, f"🤖 **Agent job started:** {brief}\n\nAnalyzing and spawning specialists…", db_session_factory)

    await broadcast(job_id, {
        "type": "text_chunk",
        "text": "Analyzing task and determining which specialist(s) to spawn...\n",
    })

    completed_sub_jobs: list[dict] = []   # track outcomes for release notes

    while True:
        response = await client.messages.create(
            model=model,
            max_tokens=2048,
            system=system_prompt,
            tools=[SPAWN_AGENT_TOOL],  # type: ignore[arg-type]
            messages=messages,
        )

        # Stream text blocks
        for block in response.content:
            if hasattr(block, "text") and block.text:
                await broadcast(job_id, {"type": "text_chunk", "text": block.text})

        # No tool call — orchestration complete, trigger auto-release
        if response.stop_reason != "tool_use":
            final_text = " ".join(
                b.text for b in response.content if hasattr(b, "text") and b.text
            )

            # Auto-release if any sub-agent made changes
            prs = [j["pr_url"] for j in completed_sub_jobs if j.get("pr_url")]
            if completed_sub_jobs:
                await _notify_chat(job_id, "🏷️ All agents done — tagging release and deploying…", db_session_factory)
                new_version = await _auto_patch_release(job_id, db_session_factory)
                if new_version:
                    pr_links = "\n".join(f"  • {u}" for u in prs) if prs else "  • (no PRs — direct commits)"
                    await _notify_chat(
                        job_id,
                        f"🚀 **{new_version} deployed.**\n\n{final_text[:400]}\n\nPRs merged:\n{pr_links}",
                        db_session_factory,
                    )
                else:
                    await _notify_chat(
                        job_id,
                        f"✅ **Agents complete.** Auto-release tag failed — push manually.\n\n{final_text[:400]}",
                        db_session_factory,
                    )
            else:
                await _notify_chat(
                    job_id,
                    f"✅ **Agent job complete** (no code changes made).\n\n{final_text[:400]}",
                    db_session_factory,
                )

            await broadcast(job_id, {
                "type": "completed",
                "summary": final_text[:500] or "Orchestration complete.",
                "pr_url": prs[0] if prs else None,
            })
            return

        # Process tool calls
        tool_results = []
        for block in response.content:
            if getattr(block, "type", None) != "tool_use":
                continue
            if block.name != "spawn_agent":
                continue

            sub_type = block.input.get("agent_type", "backend")
            sub_instruction = block.input.get("instruction", "")

            await broadcast(job_id, {
                "type": "text_chunk",
                "text": f"\n→ Spawning **{sub_type}** agent: {sub_instruction[:120]}\n",
            })
            await _notify_chat(
                job_id,
                f"🔧 **{sub_type.upper()} agent starting:** {sub_instruction[:120]}",
                db_session_factory,
            )

            sub_job_id = await _create_sub_job(
                parent_job_id=job_id,
                agent_type=sub_type,
                instruction=sub_instruction,
                db_session_factory=db_session_factory,
            )

            # Run sub-agent inline (sequential) and forward events to parent channel
            sub_model = DEFAULT_MODELS.get(sub_type, "claude-sonnet-4-6")
            from agents import approval as _approval, executor as _executor
            gate = _approval.get_or_create(sub_job_id)

            sub_result = "Sub-agent completed."
            sub_deploy_result: Optional[dict] = None
            pr_url: Optional[str] = None

            async for event in _executor.run(
                job_id=sub_job_id,
                instruction=sub_instruction,
                model=sub_model,
                approval_gate=gate,
            ):
                enriched = {**event, "sub_job_id": sub_job_id, "sub_agent_type": sub_type}
                await broadcast(sub_job_id, event)
                await broadcast(job_id, enriched)

                if event["type"] == "deploy_completed":
                    sub_deploy_result = event

                elif event["type"] == "completed":
                    sub_result = event.get("summary", "Sub-agent completed.")
                    pr_url = event.get("pr_url")

                    async with db_session_factory() as db:
                        from sqlalchemy import select
                        from db.models import AgentJob
                        row = (await db.execute(select(AgentJob).where(AgentJob.id == sub_job_id))).scalar_one_or_none()
                        if row:
                            if pr_url:
                                row.pr_url = pr_url
                            if event.get("branch"):
                                row.branch = event["branch"]
                            row.output = sub_result
                            row.status = "completed"
                            row.completed_at = datetime.now(timezone.utc)
                            await db.commit()

                    completed_sub_jobs.append({"type": sub_type, "pr_url": pr_url, "summary": sub_result})

                    # Per-agent milestone notification
                    if pr_url:
                        notify = f"✅ **{sub_type.upper()} agent done.** PR: {pr_url}"
                    elif sub_deploy_result and sub_deploy_result.get("success"):
                        notify = f"✅ **{sub_type.upper()} agent deployed** ({sub_deploy_result['target']})."
                    else:
                        notify = f"✅ **{sub_type.upper()} agent done.** {sub_result[:120]}"
                    await _notify_chat(job_id, notify, db_session_factory)

            _approval.cleanup(sub_job_id)
            _approval.cleanup_question(sub_job_id)

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": sub_result,
            })

        # Continue conversation with tool results
        messages.append({"role": "assistant", "content": response.content})  # type: ignore[arg-type]
        messages.append({"role": "user", "content": tool_results})


async def _create_sub_job(
    *,
    parent_job_id: str,
    agent_type: str,
    instruction: str,
    db_session_factory: Any,
) -> str:
    from db.models import AgentJob
    async with db_session_factory() as db:
        from sqlalchemy import select
        parent = (await db.execute(select(AgentJob).where(AgentJob.id == parent_job_id))).scalar_one()
        sub = AgentJob(
            user_id=parent.user_id,
            agent_type=agent_type,
            type="agent",
            instruction=instruction,
            repo_path=TARS_REPO,
            branch="main",
            conversation_id=parent.conversation_id,  # inherit so sub-jobs notify same chat
            parent_job_id=parent_job_id,
            status="running",
            started_at=datetime.now(timezone.utc),
            model_config_json=parent.model_config_json or {},
        )
        db.add(sub)
        await db.commit()
        await db.refresh(sub)
        return sub.id


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

    # Draft release notes via Sonnet
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    draft_prompt = (
        f"Draft release notes for a TARS personal AI system update.\n\n"
        f"Commits:\n{commits}\n\nDiff stat:\n{diff_stat}\n\n"
        "Suggest a semver version (PATCH/MINOR/MAJOR) and write concise release notes "
        "(3–8 bullet points). Format as JSON: "
        '{"version": "X.Y.Z", "notes": ["...", ...]}'
    )

    await broadcast(job_id, {"type": "text_chunk", "text": "Drafting release notes...\n"})
    resp = await client.messages.create(
        model="claude-sonnet-4-6",
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
