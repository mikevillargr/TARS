"""
Smoke test for every model path in the harness.

MAKES REAL API CALLS (a few hundred tokens total). Run it after any SDK bump,
provider change, or Settings model-routing change.

This exists because of v2.18.6/v2.18.8: the classifier, title generation and
compaction were all silently broken for ~2 months on a Z.ai tier-1 model, each
failure swallowed by a bare `except` and falling back to a heuristic. Nothing
surfaced. Every check below asserts on real output, so a silent fallback shows
up as a FAIL rather than as plausible-looking degraded behaviour.

Note tier 2 is not an afterthought: Z.ai is reached through the *Anthropic* SDK
with a base_url override, so an SDK change affects GLM calls too.

    apps/harness/.venv/bin/python scripts/check_model_paths.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import anthropic  # noqa: E402

from core.model_client import ModelTier, complete_text, get_model_client  # noqa: E402
from core.router import classify_full  # noqa: E402

failures = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        if detail:
            print(f"        {detail}")
        failures.append(label)


async def main() -> int:
    print(f"\nanthropic {anthropic.__version__}")

    print("\nclassifier (core/router.classify_full)")
    tier, category = await classify_full("write me a python function to parse a csv")
    check(
        "classifies a coding request",
        category in ("coding", "writing", "general"),
        f"tier={tier} category={category!r}",
    )
    print(f"        -> tier={tier} category={category!r}")

    tier2, cat2 = await classify_full("what's on my calendar today")
    print(f"        -> tier={tier2} category={cat2!r}")
    check("classifier returns a real category twice", bool(cat2))

    print("\ntiers (core/model_client.complete_text)")
    for name, tier_enum in [
        ("tier1", ModelTier.TIER1),
        ("tier2 (Z.ai via Anthropic SDK)", ModelTier.TIER2),
        ("tier3", ModelTier.TIER3),
    ]:
        try:
            out = await complete_text(
                "Answer with a single word, nothing else.",
                "What is the capital of France?",
                tier=tier_enum,
                max_tokens=64,
            )
            check(f"{name} returns text", "paris" in out.lower(), f"got {out[:120]!r}")
        except Exception as err:  # noqa: BLE001
            check(f"{name} returns text", False, f"{type(err).__name__}: {err}")

    print("\nstreaming (real chunk events)")
    client = get_model_client()
    chunks, done = [], None
    async for event in client.stream(
        messages=[{"role": "user", "content": "Count from 1 to 5, digits only."}],
        tier=ModelTier.TIER3,
        system="Be terse.",
        max_tokens=128,
    ):
        if event.get("type") == "chunk":
            chunks.append(event.get("text", ""))
        elif event.get("type") == "done":
            done = event
        elif event.get("type") == "error":
            check("stream has no error event", False, str(event)[:200])
    check("stream yielded chunks", len(chunks) > 0, f"{len(chunks)} chunks")
    check("stream emitted a done event", done is not None)
    if done:
        check(
            "done carries real token counts",
            (done.get("input_tokens") or 0) > 0 and (done.get("output_tokens") or 0) > 0,
            str({k: done.get(k) for k in ("input_tokens", "output_tokens", "model")}),
        )

    print("\ntool use (tier 3)")
    tool = {
        "name": "get_weather",
        "description": "Get the current weather in a city.",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    }
    calls = []

    async def executor(name, args):
        calls.append((name, args))
        return "22C and clear"

    saw_error = False
    async for event in client.stream(
        messages=[{"role": "user", "content": "What's the weather in Manila? Use the tool."}],
        tier=ModelTier.TIER3,
        system="Use tools when asked.",
        max_tokens=512,
        tools=[tool],
        tool_executor=executor,
    ):
        if event.get("type") == "error":
            saw_error = True
            check("tool stream has no error event", False, str(event)[:200])
    check("tool was actually called", len(calls) > 0, f"calls={calls}")
    if not saw_error:
        check("tool stream completed cleanly", True)

    print()
    if failures:
        print(f"{len(failures)} FAILED: {', '.join(failures)}")
        return 1
    print("all model paths OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
