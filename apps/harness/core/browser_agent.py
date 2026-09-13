"""
Browser agent loop — drives a BrowserSession with Claude's browser-use toolset.

Model choice is deliberately not the tier router's call. The toolset only runs
on Anthropic models (Z.ai GLM can't do it at all, and Haiku 4.5 isn't on the
supported list), so browser work pins to Anthropic regardless of what the
classifier decided.

Within that, the default is Sonnet 5, not Opus. Most runs are the same four
steps against the same portal every week; the expensive part was never the
clicking. Opus earns its price on a first run against an unfamiliar site, and
on escalation when Sonnet gets stuck — see `escalate_after`.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional

import anthropic

from connectors.browser import TOOLSET_TYPE, BrowserSession
from core.config import settings

log = logging.getLogger(__name__)

DRIVER_MODEL = "claude-sonnet-5"
ESCALATION_MODEL = "claude-opus-5"

MAX_TURNS = 40
MAX_TOKENS = 8192

SYSTEM = """You are operating a web browser on behalf of Mike Villar.

Work in small, verifiable steps. After any navigation or click that changes the
page, re-read the page before targeting anything — references from a previous
read go stale.

Prefer read_page and get_page_text over screenshot. Take a screenshot only when
you genuinely need to see layout or an image; they are expensive and most pages
are readable as text.

You are running in a browser that keeps a logged-in profile, so you may already
be signed in to a site without doing anything. Check before assuming otherwise.

Never type credentials yourself. If a page shows a login form, stop and say which
site needs signing into — Mike signs in by hand and you retry against that
session. Do not tell him the session will not persist; it does.

Anti-bot walls and CAPTCHAs are a real answer. If one blocks you, say exactly
what blocked you and on which page rather than retrying into it.

If a task wants a file, CLICK THE DOWNLOAD. Anything the page hands you is
captured and saved automatically — you do not need to read the file, transcribe
it, or describe its contents back. Downloading the export beats reading a table
off the screen and retyping it, and it is what Mike actually wanted.

Stop and report if you hit anything consequential that the task did not
explicitly ask for: a purchase, a deletion, an account change, or an email send.
"""


def _move_cache_breakpoint(messages: List[dict]) -> None:
    """Keep one rolling cache breakpoint on the newest message.

    Every turn re-sends the whole transcript, and in a browser run that
    transcript is mostly page reads, so the accumulated history is the only
    thing worth caching. The system prompt here is ~150 tokens, far under the
    minimum cacheable prefix, so a breakpoint on it would do nothing.

    Only one breakpoint is kept: it moves to the end each turn so the previous
    turn's history is served from cache and we pay full price only on the delta.
    """
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    block.pop("cache_control", None)
    for message in reversed(messages):
        content = message.get("content")
        if isinstance(content, list) and content and isinstance(content[-1], dict):
            content[-1]["cache_control"] = {"type": "ephemeral"}
            return


@dataclass
class BrowserRun:
    """What a completed run produced, for the caller and for Artifacts."""

    task: str
    final_text: str = ""
    turns: int = 0
    actions: List[dict] = field(default_factory=list)
    models_used: List[str] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    escalated: bool = False
    stopped_reason: str = "end_turn"
    downloads: List[dict] = field(default_factory=list)


async def run_browser_task(
    task: str,
    session: BrowserSession,
    *,
    model: str = DRIVER_MODEL,
    escalation_model: Optional[str] = ESCALATION_MODEL,
    escalate_after: int = 3,
    effort: str = "medium",
    max_turns: int = MAX_TURNS,
    on_event: Optional[Callable[[dict], Any]] = None,
) -> BrowserRun:
    """Run `task` to completion, or until we run out of turns.

    `escalate_after` consecutive turns containing a failed action swaps the
    driver up to `escalation_model`. A driver stuck in a stale-ref loop is
    exactly the case where a better one pays for itself; a driver doing the
    same four clicks it did last week is not.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    run = BrowserRun(task=task)
    messages: List[dict] = [{"role": "user", "content": task}]
    current_model = model
    current_effort = effort
    consecutive_failures = 0

    async def emit(event: dict) -> None:
        # Stamp centrally: an unstamped event falls back to the run start time
        # in the report and sorts to the top, which made recovered errors look
        # like they happened before the action that caused them.
        event.setdefault("at", time.time())
        if on_event:
            await on_event(event)

    async def _action_hook(name: str, args: dict, meta: dict) -> None:
        action = {
            "type": "action",
            "name": name,
            "input": args,
            "turn": run.turns,
            "at": time.time(),
            **meta,  # url, and box/label when the target resolved to an element
        }
        run.actions.append({"name": name, "input": args, "turn": run.turns})
        await emit(action)

    session.set_action_hook(_action_hook)

    for turn in range(max_turns):
        # Pause is honoured here and only here. Holding mid-batch would leave
        # tool_use blocks unanswered, which breaks the turn.
        if session.is_paused:
            await emit({"type": "paused"})
            await session.wait_if_paused()
            await emit({"type": "resumed"})
        run.turns = turn + 1
        if current_model not in run.models_used:
            run.models_used.append(current_model)

        _move_cache_breakpoint(messages)
        response = await client.beta.messages.create(
            model=current_model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            tools=[{"type": TOOLSET_TYPE}],
            messages=messages,
            output_config={"effort": current_effort},
            # Page reads pile up fast and go stale the moment the page changes,
            # so clear old tool results rather than letting the transcript grow
            # unbounded. This is the difference between a long run costing a
            # lot and a long run hitting the context window.
            betas=["context-management-2025-06-27"],
            context_management={"edits": [{"type": "clear_tool_uses_20250919"}]},
        )
        run.input_tokens += response.usage.input_tokens
        run.output_tokens += response.usage.output_tokens
        run.cache_read_tokens += getattr(response.usage, "cache_read_input_tokens", 0) or 0

        if response.stop_reason == "refusal":
            run.stopped_reason = "refusal"
            run.final_text = "The model declined this task."
            await emit({"type": "refusal"})
            return run

        text = "".join(b.text for b in response.content if b.type == "text")

        if response.stop_reason != "tool_use":
            run.final_text = text
            run.stopped_reason = response.stop_reason or "end_turn"
            run.downloads = list(session.downloads)
            await emit({"type": "done", "text": text})
            return run

        if text:
            await emit({"type": "say", "text": text})

        messages.append(
            {"role": "assistant", "content": [b.model_dump() for b in response.content]}
        )
        results = await session.execute_batch(response.content)
        messages.append({"role": "user", "content": results})

        failed = [r for r in results if r.get("is_error")]
        for result in failed:
            await emit({"type": "action_error", "detail": str(result.get("content"))[:300]})

        if failed:
            consecutive_failures += 1
            if (
                escalation_model
                and not run.escalated
                and consecutive_failures >= escalate_after
            ):
                log.info("browser agent escalating %s -> %s", current_model, escalation_model)
                current_model = escalation_model
                # Stuck is the one situation worth thinking harder about, so the
                # escalation raises effort as well as swapping the driver.
                current_effort = "high"
                run.escalated = True
                await emit({"type": "escalated", "model": escalation_model})
        else:
            consecutive_failures = 0

    run.downloads = list(session.downloads)
    run.stopped_reason = "max_turns"
    run.final_text = run.final_text or "Ran out of turns before finishing."
    await emit({"type": "exhausted"})
    return run
