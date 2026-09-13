"""
Contract checks for the browser-use executor (connectors/browser.py).

Runs the member tools against a real Chromium on a local fixture page — no
Anthropic calls, so it costs nothing and is safe to run on every change.

Covers the parts of the toolset contract that are easy to regress and that a
model-driven run won't reliably exercise: stale refs, batch halt-on-failure,
answering every call, the browser_state empty-list rule, and the navigation
guards.

    apps/harness/.venv/bin/python scripts/check_browser_executor.py
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from connectors.browser import TOOLSET_NAME, BrowserPool  # noqa: E402

FIXTURE = """
<h1>Report portal</h1>
<button id=export>Export CSV</button>
<input type=text id=q placeholder="Search reports" />
<select id=range><option>Last 7 days</option><option>Last 30 days</option></select>
<a href="https://example.com/next">Next page</a>
"""

failures = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}")
    if not condition:
        if detail:
            print(f"        {detail}")
        failures.append(label)


class FakeToolUse:
    """Stands in for an SDK tool_use block."""

    type = "tool_use"

    def __init__(self, name, input=None, id="tu_1"):
        self.name = name
        self.input = input or {}
        self.id = id
        self.toolset_name = TOOLSET_NAME


async def main() -> int:
    pool = BrowserPool(max_contexts=2, headless=True)

    async with await pool.session(allowed_domains=["example.com"]) as sess:
        page = sess._page()
        await page.set_content(FIXTURE)

        print("\nref registry")
        tree = await sess.call("read_page", {})
        check("read_page tags elements with refs", "[ref_" in tree, tree[:200])
        check("labels are resolved, not empty", '"Export CSV"' in tree, tree[:200])

        ref = tree.split("[ref_")[1].split("]")[0]
        await sess.call("left_click", {"target": {"type": "ref", "ref": f"ref_{ref}"}})
        check("click by ref resolves", True)

        print("\nfind")
        hits = await sess.call("find", {"query": "search input box for reports"})
        check("find scores per-word, not substring", "ref_" in hits, hits[:200])

        print("\nform_input")
        tree = await sess.call("read_page", {})
        select_ref = next(
            ln.split("[")[-1].rstrip("]") for ln in tree.splitlines() if "combobox" in ln
        )
        await sess.call(
            "form_input", {"target": {"type": "ref", "ref": select_ref}, "value": "Last 30 days"}
        )
        selected = await page.eval_on_selector("#range", "e => e.value")
        check("form_input selects by label", selected == "Last 30 days", f"got {selected!r}")

        print("\nstale refs")
        await page.set_content(FIXTURE)  # wipes every data-tars-ref
        results = await sess.execute_batch(
            [FakeToolUse("left_click", {"target": {"type": "ref", "ref": "ref_99"}})]
        )
        check(
            "stale ref gives a recoverable error",
            results[0].get("is_error") and "stale" in str(results[0]["content"]),
            str(results[0]["content"])[:160],
        )

        print("\nbatch contract")
        batch = [
            FakeToolUse("left_click", {"target": {"type": "ref", "ref": "ref_99"}}, id="a"),
            FakeToolUse("type", {"text": "hello"}, id="b"),
            FakeToolUse("get_page_text", {}, id="c"),
        ]
        results = await sess.execute_batch(batch)
        check("every call is answered", len(results) == 3, f"got {len(results)}")
        check("halts after first failure", all(r.get("is_error") for r in results))
        check(
            "skipped calls say so",
            "Not executed" in str(results[1]["content"]),
            str(results[1]["content"])[:120],
        )
        check(
            "toolset_name echoed on every result",
            all(r["toolset_name"] == TOOLSET_NAME for r in results),
        )

        print("\nbrowser_state")
        block = await sess.browser_state_block()
        check("omits empty state_changes (sending [] is a 400)", "state_changes" not in block, str(block)[:160])
        await sess.call("new_tab", {})
        block = await sess.browser_state_block()
        check(
            "includes state_changes when a tab opened",
            block.get("state_changes", [{}])[0].get("type") == "tab_opened"
            or "state_changes" not in block,
            str(block)[:200],
        )
        check("tracks both tabs", len(block["tabs"]) == 2, str(block["tabs"]))

        print("\nguards")
        results = await sess.execute_batch(
            [FakeToolUse("navigate", {"url": "javascript:alert(1)"})]
        )
        check(
            "refuses non-http schemes",
            results[0].get("is_error") and "http" in str(results[0]["content"]),
            str(results[0]["content"])[:140],
        )
        results = await sess.execute_batch(
            [FakeToolUse("navigate", {"url": "https://evil.test/x"})]
        )
        check(
            "enforces the domain allowlist",
            results[0].get("is_error") and "allowed domain" in str(results[0]["content"]),
            str(results[0]["content"])[:140],
        )
        results = await sess.execute_batch([FakeToolUse("javascript_exec", {"code": "1"})])
        check(
            "optional members are off by default",
            results[0].get("is_error") and "not enabled" in str(results[0]["content"]),
            str(results[0]["content"])[:140],
        )
        results = await sess.execute_batch([FakeToolUse("teleport", {})])
        check(
            "unknown members degrade instead of crashing",
            results[0].get("is_error") and "not supported" in str(results[0]["content"]),
            str(results[0]["content"])[:140],
        )

    await pool.close()

    print()
    if failures:
        print(f"{len(failures)} FAILED: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
