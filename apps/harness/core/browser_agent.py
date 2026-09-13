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

Never enter credentials. If a page asks you to log in, stop and say so — a human
will handle it and re-run you against an authenticated session.

Stop and report if you hit anything consequential that the task did not
explicitly ask for: a purchase, a deletion, an account change, or an email send.
"""


# anthropic==0.43.0 predates this response shape, so `model_dump()` on a content
# block emits fields the API then rejects on the way back in: a stray
# `text: null` on thinking blocks (400 "thinking.text: Extra inputs are not
# permitted") and a `caller` object on tool_use. Echo an explicit whitelist
# instead. DELETE THIS once the SDK is on 1.x and model_dump round-trips cleanly.
_ECHO_FIELDS = {
    "thinking": ("type", "thinking", "signature"),
    "redacted_thinking": ("type", "data"),
    "text": ("type", "text"),
    "tool_use": ("type", "id", "name", "input", "toolset_name"),
}


def _echo_blocks(content) -> List[dict]:
    out = []
    for block in content:
        dumped = block.model_dump()
        keep = _ECHO_FIELDS.get(dumped.get("type"))
        out.append(
            {k: v for k, v in dumped.items() if k in keep} if keep else dumped
        )
    return out


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
    escalated: bool = False
    stopped_reason: str = "end_turn"


async def run_browser_task(
    task: str,
    session: BrowserSession,
    *,
    model: str = DRIVER_MODEL,
    escalation_model: Optional[str] = ESCALATION_MODEL,
    escalate_after: int = 3,
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
    consecutive_failures = 0

    async def emit(event: dict) -> None:
        if on_event:
            await on_event(event)

    for turn in range(max_turns):
        run.turns = turn + 1
        if current_model not in run.models_used:
            run.models_used.append(current_model)

        response = await client.messages.create(
            model=current_model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            tools=[{"type": TOOLSET_TYPE}],
            messages=messages,
        )
        run.input_tokens += response.usage.input_tokens
        run.output_tokens += response.usage.output_tokens

        if response.stop_reason == "refusal":
            run.stopped_reason = "refusal"
            run.final_text = "The model declined this task."
            await emit({"type": "refusal"})
            return run

        text = "".join(b.text for b in response.content if b.type == "text")

        if response.stop_reason != "tool_use":
            run.final_text = text
            run.stopped_reason = response.stop_reason or "end_turn"
            await emit({"type": "done", "text": text})
            return run

        if text:
            await emit({"type": "say", "text": text})

        # Record what was requested before running it, so the live panel can
        # highlight the target element before the click lands.
        for block in response.content:
            if block.type == "tool_use" and getattr(block, "toolset_name", None) == "browser":
                action = {"name": block.name, "input": block.input, "turn": run.turns}
                run.actions.append(action)
                await emit({"type": "action", **action})

        messages.append({"role": "assistant", "content": _echo_blocks(response.content)})
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
                run.escalated = True
                await emit({"type": "escalated", "model": escalation_model})
        else:
            consecutive_failures = 0

    run.stopped_reason = "max_turns"
    run.final_text = run.final_text or "Ran out of turns before finishing."
    await emit({"type": "exhausted"})
    return run
