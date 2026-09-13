"""
Turning a finished browser run into something you can read later.

Three possible artifacts, each with a different job:

  - The **report** (markdown) is the one that matters. It is text, so it embeds,
    it is searchable in Artifacts, and TARS can read it back in a later
    conversation. It answers "what did it do at 3am" without opening anything.
  - The **video** and the **trace** are saved only when a run went BADLY. Both
    answer "why did that go wrong", and neither is worth keeping for a run that
    worked: saving a screen recording of every routine browse buried the library
    under tens of MB of footage nobody will ever watch. The live panel already
    shows a run as it happens, and the report carries the action log afterwards.
  - The trace additionally It carries a DOM snapshot per
    action and is the right tool for working out why something broke, but it
    needs Playwright's own viewer to open (`npx playwright show-trace`), so
    attaching one to every successful run would be weight nobody opens.
"""

import base64
import logging
import os
import re
import urllib.parse
from datetime import datetime, timezone
from typing import List, Optional

from db.models import Artifact

log = logging.getLogger(__name__)

# Base64 inflates by ~33% and this lands in a Text column. A minute of 1280x800
# webm is roughly 1-3MB; the cap is there to stop a pathological 20-minute run
# putting 60MB in one row, not to be stingy about normal ones.
MAX_MEDIA_BYTES = 12 * 1024 * 1024


def _clock(ts: Optional[float]) -> str:
    if not ts:
        return ""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%H:%M:%S")


def build_report(run, job_id: str, events: List[dict]) -> str:
    """A readable account of the run, in the same two voices as the live panel."""
    started = events[0].get("at") if events and events[0].get("at") else None
    lines = [
        f"# Browser run · {job_id}",
        "",
        f"**Task:** {run.task}",
        "",
        "| | |",
        "|---|---|",
        f"| Outcome | {run.stopped_reason} |",
        f"| Turns | {run.turns} |",
        f"| Actions | {len(run.actions)} |",
        f"| Models | {', '.join(run.models_used) or 'n/a'} |",
        f"| Escalated | {'yes' if run.escalated else 'no'} |",
        f"| Tokens in/out | {run.input_tokens} / {run.output_tokens} |",
        f"| Served from cache | {run.cache_read_tokens} |",
        "",
        "## What it did",
        "",
    ]

    for event in events:
        kind = event.get("type")
        when = _clock(event.get("at") or started)
        if kind == "action":
            label = event.get("label")
            inp = event.get("input") or {}
            target = (
                label
                or inp.get("url")
                or inp.get("query")
                or inp.get("text")
                or (f'"{inp["value"]}"' if inp.get("value") is not None else "")
            )
            lines.append(f"- `{when}` **{event['name']}** {target}".rstrip())
        elif kind == "action_error":
            lines.append(f"- `{when}` **failed** — {event.get('detail', '')}")
        elif kind == "escalated":
            lines.append(f"- `{when}` **escalated to {event.get('model')}**")
        elif kind == "paused":
            lines.append(f"- `{when}` held")
        elif kind == "resumed":
            lines.append(f"- `{when}` resumed")

    if getattr(run, "downloads", None):
        lines += ["", "## Files it brought back", ""]
        for d in run.downloads:
            kb = (d.get("size_bytes") or 0) / 1024
            lines.append(f"- `{d.get('filename')}` ({kb:.0f} KB)")

    if run.final_text:
        lines += ["", "## Result", "", run.final_text]

    return "\n".join(lines)


# Words that carry no information in a filename. Almost every task starts with
# some arrangement of these, so slugging naively yields "go-to-https-en-..."
# which tells you nothing in a list of artifacts.
_FILLER = {
    "go", "to", "the", "a", "an", "and", "use", "using", "your", "my", "you",
    "browser", "open", "please", "then", "on", "in", "at", "of", "for", "with",
    "from", "me", "i", "it", "that", "this", "page", "site", "web", "www",
    "http", "https", "com", "org", "net", "html", "php", "aspx", "tell", "give",
    "report", "back", "get", "find", "check", "look", "up",
}


def _slug(task: str, domain: Optional[str] = None) -> str:
    """A filename that says what the run was about.

    URLs and filler are stripped first; the domain leads, because in a list of
    artifacts "which site" is the thing you scan for.
    """
    # Strip URLs and any bare domain-looking token. The old TLD list missed
    # country codes, so "shopee.ph" survived and the slug read
    # "shopee-ph-shopee-ph-search-..." with the domain twice.
    stripped = re.sub(r"https?://\S+", " ", task, flags=re.I)
    stripped = re.sub(r"\b[\w-]+(\.[a-z]{2,})+\b\S*", " ", stripped, flags=re.I)
    words = [
        # Apostrophes are legal in filenames but make every later `curl`, `scp`
        # or shell move need quoting. Drop them rather than inherit the problem.
        w.lower().replace("'", "")
        for w in re.findall(r"[A-Za-z0-9']+", stripped)
        if w.lower().strip("'") not in _FILLER and len(w.strip("'")) > 1
    ]
    parts = []
    if domain:
        parts.append(re.sub(r"[^a-z0-9]+", "-", domain.lower().replace("www.", "")).strip("-"))
    parts += words[:5]
    return "-".join(p for p in parts if p) or "browser-run"


def _domain_of(events: List[dict]) -> Optional[str]:
    for event in events:
        url = event.get("url")
        if url:
            try:
                host = urllib.parse.urlparse(url).hostname
                if host:
                    return host
            except Exception:  # noqa: BLE001
                continue
    return None


def artifacts_for_run(
    run,
    job_id: str,
    events: List[dict],
    user_id: str,
    *,
    video_path: Optional[str] = None,
    trace_path: Optional[str] = None,
) -> List[Artifact]:
    """Build the Artifact rows for a finished run. Caller adds and commits."""
    stem = f"{_slug(run.task, _domain_of(events))}-{job_id[:8]}"
    out: List[Artifact] = []

    report = build_report(run, job_id, events)
    out.append(
        Artifact(
            user_id=user_id,
            filename=f"{stem}.md",
            type="report",
            source="browser",
            source_id=job_id,
            content=report,
            size_bytes=len(report.encode("utf-8")),
            tags=["browser", run.stopped_reason],
        )
    )

    # A stale ref is the NORMAL recoverable error here — pages re-render and the
    # agent re-reads and carries on — so "any error" would attach a ~10MB trace
    # to almost every real run. Reserve it for runs that actually went badly:
    # they never finished, or they were still thrashing when they did.
    error_count = len([e for e in events if e.get("type") == "action_error"])
    failed = run.stopped_reason in ("max_turns", "refusal") or error_count >= 3

    # Nothing heavy on a run that worked. The report is the record; footage and
    # traces are diagnostics, and diagnostics for a success are just clutter.
    media = []
    if failed:
        media.append(("video", video_path, "webm", "video/webm"))
        if trace_path:
            media.append(("trace", trace_path, "zip", "application/zip"))

    for kind, path, ext, _mime in media:
        if not path or not os.path.exists(path):
            continue
        try:
            size = os.path.getsize(path)
            if size > MAX_MEDIA_BYTES:
                log.info(
                    "browser %s: skipping %s (%.1fMB over cap)", job_id, kind, size / 1e6
                )
                continue
            with open(path, "rb") as fh:
                encoded = "base64:" + base64.b64encode(fh.read()).decode()
            out.append(
                Artifact(
                    user_id=user_id,
                    filename=f"{stem}.{ext}",
                    type="transcript" if kind == "trace" else "document",
                    source="browser",
                    source_id=job_id,
                    content=encoded,
                    size_bytes=size,
                    tags=["browser", kind],
                )
            )
        except Exception as err:  # noqa: BLE001 — a missing recording is not a failed run
            log.warning("browser %s: could not attach %s: %s", job_id, kind, err)

    return out
