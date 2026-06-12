#!/usr/bin/env python3
"""
Test all Z.ai GLM models.

Usage:
    ZAI_API_KEY=your-key python scripts/test_glm_models.py

Requires: pip install anthropic openai
"""
import asyncio
import os
import sys
import time

ZAI_API_KEY = os.environ.get("ZAI_API_KEY", "")
ZAI_BASE_URL = "https://api.z.ai/api/anthropic"
ZAI_OPENAI_BASE_URL = "https://api.z.ai/api/paas/v4/"
PROMPT = "Reply with exactly: TARS online"

# GLM-4.x go through Z.ai's Anthropic-compatible endpoint
ANTHROPIC_ENDPOINT_MODELS = [
    ("glm-4.5-flash",       "FREE"),
    ("glm-4.7-flash",       "FREE"),
    ("glm-4-32b-0414-128k", "$0.1/$0.1"),
    ("glm-4.7-flashx",      "$0.07/$0.4"),
    ("glm-4.5-airx",        "$1.1/$4.5"),
    ("glm-4.5-air",         "$0.2/$1.1"),
    ("glm-4.5",             "$0.6/$2.2"),
    ("glm-4.5-x",           "$2.2/$8.9"),
    ("glm-4.6",             "$0.6/$2.2"),
    ("glm-4.7",             "$0.6/$2.2"),
    # GLM-4.x vision (Anthropic endpoint — text-only test)
    ("glm-4.6v-flash",      "FREE (vision)"),
    ("glm-4.6v-flashx",     "$0.04/$0.4 (vision)"),
    ("glm-4.5v",            "$0.6/$1.8 (vision)"),
    ("glm-4.6v",            "$0.3/$0.9 (vision)"),
]

# GLM-5.x go through Z.ai's OpenAI-compatible endpoint
OPENAI_ENDPOINT_MODELS = [
    ("glm-5",               "$1.0/$3.2"),
    ("glm-5-turbo",         "$1.2/$4.0"),
    ("glm-5.1",             "$1.4/$4.4"),
    ("glm-5v-turbo",        "$1.2/$4.0 (vision)"),
]

RESET  = "\033[0m"
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BOLD   = "\033[1m"
DIM    = "\033[2m"


async def test_anthropic(client, model: str, pricing: str) -> tuple[bool, str, int]:
    t0 = time.time()
    try:
        resp = await client.messages.create(
            model=model,
            max_tokens=32,
            messages=[{"role": "user", "content": PROMPT}],
        )
        text = resp.content[0].text if resp.content else "(empty)"
        ms = int((time.time() - t0) * 1000)
        return True, text.strip(), ms
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return False, str(e)[:120], ms


async def test_openai(client, model: str, pricing: str) -> tuple[bool, str, int]:
    t0 = time.time()
    try:
        resp = await client.chat.completions.create(
            model=model,
            max_tokens=32,
            messages=[{"role": "user", "content": PROMPT}],
        )
        text = resp.choices[0].message.content if resp.choices else "(empty)"
        ms = int((time.time() - t0) * 1000)
        return True, text.strip(), ms
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return False, str(e)[:120], ms


async def main():
    if not ZAI_API_KEY:
        print(f"{RED}Error: ZAI_API_KEY env var not set{RESET}")
        print("Usage: ZAI_API_KEY=your-key python scripts/test_glm_models.py")
        sys.exit(1)

    import anthropic
    from openai import AsyncOpenAI

    ant_client = anthropic.AsyncAnthropic(api_key=ZAI_API_KEY, base_url=ZAI_BASE_URL)
    oai_client = AsyncOpenAI(api_key=ZAI_API_KEY, base_url=ZAI_OPENAI_BASE_URL)

    print(f"\n{BOLD}Z.ai GLM Model Test{RESET}  (prompt: \"{PROMPT}\")\n")
    passed = 0
    failed = 0

    print(f"{BOLD}── Anthropic-compatible endpoint ({ZAI_BASE_URL}) ──{RESET}")
    for model, pricing in ANTHROPIC_ENDPOINT_MODELS:
        ok, text, ms = await test_anthropic(ant_client, model, pricing)
        tag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        free_badge = f" {YELLOW}FREE{RESET}" if "FREE" in pricing else ""
        print(f"  {tag}{free_badge}  {model:<28} {DIM}{pricing:<18} {ms}ms{RESET}")
        if ok:
            print(f"        {DIM}→ {text}{RESET}")
            passed += 1
        else:
            print(f"        {RED}→ {text}{RESET}")
            failed += 1

    print(f"\n{BOLD}── OpenAI-compatible endpoint ({ZAI_OPENAI_BASE_URL}) ──{RESET}")
    for model, pricing in OPENAI_ENDPOINT_MODELS:
        ok, text, ms = await test_openai(oai_client, model, pricing)
        tag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
        print(f"  {tag}  {model:<28} {DIM}{pricing:<18} {ms}ms{RESET}")
        if ok:
            print(f"        {DIM}→ {text}{RESET}")
            passed += 1
        else:
            print(f"        {RED}→ {text}{RESET}")
            failed += 1

    total = passed + failed
    color = GREEN if failed == 0 else RED
    print(f"\n{color}{BOLD}{passed}/{total} models passed{RESET}\n")


if __name__ == "__main__":
    asyncio.run(main())
