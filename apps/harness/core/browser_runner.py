"""
One place that runs a `browse_web` call.

Chat and cron both need the whole sequence — pool session, screencast for the
live panel, the agent loop, downloads into Artifacts, the run report — and the
only thing that differs is whether anyone is watching. Duplicating it would mean
a scheduled run quietly missing whatever the chat path gained last.
"""

import logging
from typing import Any, Callable, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


async def execute_browse_web(
    tool_input: dict,
    user_id: str,
    db: AsyncSession,
    *,
    on_progress: Optional[Callable[[str, dict], Any]] = None,
) -> str:
    """Run one browse_web tool call and return what the model should see.

    `on_progress(status, extra)` is optional: chat uses it to drive the live
    panel, cron passes nothing because there is nobody watching at 8am.
    """
    from connectors.browser import get_browser_pool
    from core.browser_agent import run_browser_task
    from core.browser_artifacts import artifacts_for_run
    from core.browser_downloads import artifacts_for_downloads
    from core.browser_jobs import get_browser_jobs

    task_text = (tool_input.get("task") or "").strip()
    if not task_text:
        return "browse_web needs a task describing what to accomplish."

    jobs = get_browser_jobs()
    job = jobs.create(task_text)

    async def progress(status: str) -> None:
        if on_progress:
            await on_progress(status, {"job_id": job.id})

    await progress("Opening browser…")

    async def _on_event(event: dict) -> None:
        await jobs.publish(job.id, event)
        if event.get("type") == "action":
            target = (
                event["input"].get("url")
                or event["input"].get("query")
                or (event["input"].get("target") or {}).get("ref")
                or ""
            )
            await progress(f"{event['name']} {str(target)[:50]}".strip())

    try:
        pool = get_browser_pool()
        ctx = await pool.session(
            allowed_domains=tool_input.get("allowed_domains"), record=True
        )
        async with ctx as session:
            jobs.attach_session(job.id, session)

            async def _on_frame(frame: dict) -> None:
                await jobs.publish_frame(job.id, frame)

            await session.start_screencast(_on_frame)
            run = await run_browser_task(task_text, session, on_event=_on_event)
    except Exception as exc:  # noqa: BLE001
        log.exception("browse_web failed")
        jobs.finish(job.id, error=str(exc))
        return f"Browser run failed: {type(exc).__name__}: {exc}"

    jobs.finish(job.id, result=run.final_text)

    # Persist afterwards. A recording or storage problem must never turn a
    # successful run into a failure: the browsing happened and the answer is good.
    saved: List[str] = []
    try:
        for artifact in await artifacts_for_downloads(run.downloads, job.id, user_id):
            db.add(artifact)
            saved.append(artifact.filename)
        for artifact in artifacts_for_run(
            run, job.id, jobs.get(job.id).events if jobs.get(job.id) else [], user_id,
            video_path=ctx.video_path, trace_path=ctx.trace_path,
        ):
            db.add(artifact)
            saved.append(artifact.filename)
        await db.commit()
    except Exception:  # noqa: BLE001
        log.exception("browse_web: saving artifacts failed")
    finally:
        ctx.cleanup()

    summary = (
        f"[browser job {job.id} · {run.turns} turns · {len(run.actions)} actions · "
        f"{'/'.join(run.models_used)}{' · escalated' if run.escalated else ''}"
        f"{' · saved: ' + ', '.join(saved) if saved else ''}]\n\n{run.final_text}"
    )
    if run.downloads:
        names = ", ".join(d["filename"] for d in run.downloads)
        summary += (
            f"\n\nDownloaded and saved to Artifacts: {names}. "
            f"Use save_artifact_to_brain if Mike wants any of it kept in Second Brain."
        )
    if run.stopped_reason == "max_turns":
        summary += (
            "\n\n(Ran out of turns before finishing. Report this to Mike rather "
            "than guessing the rest.)"
        )
    return summary


async def execute_archive_page(
    tool_input: dict, user_id: str, db: AsyncSession
) -> str:
    """Archive a page as a PDF and a full-page image, both into Artifacts.

    Explicitly requested, never automatic. Saving a PDF of every page a run
    touched is exactly the noise that buried the library the first time.
    """
    import base64
    import re as _re

    from connectors.browser import get_browser_pool
    from db.models import Artifact

    url = (tool_input.get("url") or "").strip()
    if not url:
        return "archive_page needs a url."

    pool = get_browser_pool()
    try:
        ctx = await pool.session(allowed_domains=tool_input.get("allowed_domains"))
        async with ctx as session:
            page = session._page()
            await page.goto(session._check_url(url), wait_until="networkidle")
            captured = await session.archive_page()
    except Exception as exc:  # noqa: BLE001
        log.exception("archive_page failed")
        return f"Could not archive {url}: {type(exc).__name__}: {exc}"

    stem = _re.sub(r"[^a-z0-9]+", "-", (captured.get("title") or url).lower()).strip("-")[:60] or "page"
    saved = []
    for key, ext in (("pdf", "pdf"), ("png", "png")):
        raw = captured.get(key)
        if not raw:
            continue
        db.add(
            Artifact(
                user_id=user_id,
                filename=f"{stem}.{ext}",
                type="image" if ext == "png" else "document",
                source="browser",
                content="base64:" + base64.b64encode(raw).decode(),
                size_bytes=len(raw),
                tags=["browser", "archive"],
            )
        )
        saved.append(f"{stem}.{ext}")
    await db.commit()

    if not saved:
        return f"Reached {captured.get('url')} but could not capture anything."
    return (
        f"Archived '{captured.get('title') or url}' to Artifacts: {', '.join(saved)}."
    )
