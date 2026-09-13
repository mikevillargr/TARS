"""
Browser connector — executes Anthropic's browser-use toolset against a real
Chromium via Playwright.

The model never touches the browser. It emits member tool_use blocks
(`navigate`, `read_page`, `left_click`, ...) carrying `toolset_name: "browser"`;
this module runs them and hands back tool_result blocks. Everything here is
client-side — Anthropic only ever sees the results we choose to return.

Element targeting is by reference, not pixel. `read_page` / `find` tag every
interactive element with a `data-tars-ref` attribute and hand the model back a
tree of `[ref_N]` markers; a later click resolves that ref through a normal
Playwright locator. A ref that no longer exists resolves to zero nodes, which
is how we detect (and report) staleness rather than clicking the wrong thing.

Contract rules that are easy to get wrong, all enforced in `execute_batch`:
  - run a turn's calls sequentially, in order
  - halt at the first failure, but still answer every remaining call
  - echo `toolset_name: "browser"` on every result
  - emit a `browser_state` block on navigation and tab changes, and OMIT
    `state_changes` when empty (sending `[]` is a 400)
"""

import asyncio
import base64
import logging
import re
import urllib.parse
from typing import Any, Dict, List, Optional

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

log = logging.getLogger(__name__)

TOOLSET_TYPE = "browser_toolset_20260801"
TOOLSET_NAME = "browser"

VIEWPORT = {"width": 1280, "height": 800}
DEFAULT_TIMEOUT_MS = 15_000
MAX_PAGE_TEXT_CHARS = 40_000

# Members that are opt-in via `configs` and stay off unless explicitly enabled.
# Each one widens the prompt-injection blast radius, so the default is closed.
OPTIONAL_MEMBERS = {"javascript_exec", "file_upload", "read_console", "read_network"}


class BrowserActionError(Exception):
    """A member tool failed in a way the model should see and can recover from."""


# --------------------------------------------------------------------------
# Ref registry
# --------------------------------------------------------------------------
# Walks the DOM, tags candidate elements with data-tars-ref, and returns an
# indented accessibility-ish tree. Runs fresh on every read_page/find so refs
# always describe the page as it is now.

_REF_SCRIPT = """
(opts) => {
  const { filter, maxDepth, scopeRef } = opts;
  document.querySelectorAll('[data-tars-ref]').forEach(e => e.removeAttribute('data-tars-ref'));

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],' +
    '[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],' +
    '[role=combobox],[role=switch],[role=textbox],[contenteditable=true],[onclick],[tabindex]';

  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const name = (el) => {
    const pick = (v) => (v || '').replace(/\\s+/g, ' ').trim();
    let n = pick(el.getAttribute('aria-label'));
    if (!n && el.getAttribute('aria-labelledby')) {
      const t = document.getElementById(el.getAttribute('aria-labelledby'));
      if (t) n = pick(t.innerText);
    }
    if (!n) n = pick(el.getAttribute('alt')) || pick(el.getAttribute('placeholder'));
    if (!n) n = pick(el.getAttribute('title'));
    if (!n && el.tagName === 'INPUT' && el.labels && el.labels.length) n = pick(el.labels[0].innerText);
    if (!n) n = pick(el.innerText || el.textContent);
    if (!n) n = pick(el.value);
    return n.slice(0, 120);
  };

  const role = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'submit' || t === 'button') return 'button';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    return tag;
  };

  const root = scopeRef
    ? document.querySelector('[data-tars-ref="' + scopeRef + '"]')
    : document.body;
  if (!root) return { error: 'scope ref not found' };

  const lines = [];
  let n = 0;
  const wantAll = filter === 'all';

  const walk = (el, depth) => {
    if (depth > maxDepth) return;
    for (const child of el.children) {
      if (!visible(child)) continue;
      const isInteractive = child.matches(INTERACTIVE);
      const label = name(child);
      // Static nodes only earn a line in `all` mode, and only if they carry
      // text that isn't already covered by a descendant we'll emit anyway.
      const isLeafText = wantAll && label && child.children.length === 0;
      if (isInteractive || isLeafText) {
        const ref = 'ref_' + (++n);
        child.setAttribute('data-tars-ref', ref);
        const r = role(child);
        const disabled = child.disabled ? ' [disabled]' : '';
        const checked = child.checked ? ' [checked]' : '';
        lines.push('  '.repeat(depth) + `${r} "${label}"${disabled}${checked} [${ref}]`);
      }
      walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return { tree: lines.join('\\n'), count: n };
}
"""

# Claude sends xdotool-style key names; Playwright wants its own vocabulary.
_KEY_ALIASES = {
    "return": "Enter",
    "enter": "Enter",
    "tab": "Tab",
    "escape": "Escape",
    "esc": "Escape",
    "space": "Space",
    "backspace": "Backspace",
    "delete": "Delete",
    "up": "ArrowUp",
    "down": "ArrowDown",
    "left": "ArrowLeft",
    "right": "ArrowRight",
    "page_up": "PageUp",
    "page_down": "PageDown",
    "home": "Home",
    "end": "End",
    "ctrl": "Control",
    "cmd": "Meta",
    "super": "Meta",
    "alt": "Alt",
    "shift": "Shift",
}


def _translate_key(combo: str) -> str:
    parts = re.split(r"[+\-]", combo.strip()) if combo.strip() not in ("-", "+") else [combo]
    out = []
    for part in parts:
        low = part.lower()
        out.append(_KEY_ALIASES.get(low, part if len(part) > 1 else part.upper()))
    return "+".join(out)


class BrowserSession:
    """One Chromium context, its tabs, and the member-tool dispatch over them.

    Cheap relative to a browser process: contexts share the Chromium launched
    by `BrowserPool`, so concurrency is bounded by CPU rather than RAM.
    """

    def __init__(
        self,
        context,
        *,
        allowed_domains: Optional[List[str]] = None,
        enabled_optional: Optional[List[str]] = None,
        on_action=None,
    ):
        self._ctx = context
        self._allowed = [d.lower() for d in (allowed_domains or [])]
        self._enabled_optional = set(enabled_optional or [])
        self._on_action = on_action  # async cb(name, payload) -> live panel feed
        self._tabs: Dict[str, Any] = {}
        self._tab_seq = 0
        self._active: Optional[str] = None
        self._pending_state_changes: List[dict] = []

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        pages = self._ctx.pages
        page = pages[0] if pages else await self._ctx.new_page()
        page.set_default_timeout(DEFAULT_TIMEOUT_MS)
        self._register_tab(page)
        self._pending_state_changes.clear()

    def _register_tab(self, page) -> str:
        self._tab_seq += 1
        tab_id = f"tab-{self._tab_seq}"  # never reused while open
        self._tabs[tab_id] = page
        self._active = tab_id
        page.on("close", lambda _p, t=tab_id: self._tabs.pop(t, None))
        return tab_id

    def _page(self, tab_id: Optional[str] = None):
        key = tab_id or self._active
        page = self._tabs.get(key)
        if page is None:
            raise BrowserActionError(f"Unknown tab {key!r}. Call list_tabs for current tabs.")
        return page

    # -- guards ------------------------------------------------------------

    def _check_url(self, url: str) -> str:
        # Parse BEFORE defaulting the scheme. Prepending https:// to anything
        # lacking "://" rewrites `javascript:alert(1)` into a valid https URL
        # and smuggles it straight past the scheme check.
        parsed = urllib.parse.urlparse(url.strip())
        if not parsed.scheme:
            parsed = urllib.parse.urlparse("https://" + url.strip().lstrip("/"))
        if parsed.scheme not in ("http", "https"):
            raise BrowserActionError(
                "Navigation refused. Only http and https URLs are allowed."
            )
        if self._allowed:
            host = (parsed.hostname or "").lower()
            ok = any(host == d or host.endswith(f".{d}") for d in self._allowed)
            if not ok:
                raise BrowserActionError(
                    f"Navigation refused. {host} is not in the allowed domain list."
                )
        return parsed.geturl()

    async def _resolve(self, target: dict, page):
        """Turn a Target into something clickable, or explain why we can't."""
        kind = (target or {}).get("type")
        if kind == "coordinate":
            return ("coordinate", (target["x"], target["y"]))
        if kind == "ref":
            ref = target["ref"]
            loc = page.locator(f'[data-tars-ref="{ref}"]')
            if await loc.count() == 0:
                raise BrowserActionError(
                    f"Error: {ref} is stale or not found. Re-read the page to get fresh references."
                )
            return ("locator", loc.first)
        raise BrowserActionError(f"Unsupported target type {kind!r}.")

    # -- browser_state -----------------------------------------------------

    async def browser_state_block(self) -> dict:
        tabs = []
        for tab_id, page in list(self._tabs.items()):
            try:
                tabs.append(
                    {
                        "tab_id": tab_id,
                        "title": (await page.title())[:200],
                        "url": page.url,
                        **({"active": True} if tab_id == self._active else {}),
                    }
                )
            except PlaywrightError:
                continue
        block = {"type": "browser_state", "tabs": tabs}
        # The API rejects an empty list, so only include the key when non-empty.
        if self._pending_state_changes:
            block["state_changes"] = self._pending_state_changes
            self._pending_state_changes = []
        return block

    # -- member dispatch ---------------------------------------------------

    async def call(self, name: str, args: dict) -> Any:
        if name in OPTIONAL_MEMBERS and name not in self._enabled_optional:
            raise BrowserActionError(f"Error: {name} is not enabled in this environment.")
        handler = getattr(self, f"_m_{name}", None)
        if handler is None:
            raise BrowserActionError(f"Error: member tool {name!r} is not supported by this executor.")
        if self._on_action:
            await self._on_action(name, args)
        return await handler(args)

    # navigation & capture

    async def _m_navigate(self, a: dict):
        page = self._page(a.get("tab_id"))
        raw = a.get("url", "")
        if raw in ("back", "forward", "reload"):
            await {"back": page.go_back, "forward": page.go_forward, "reload": page.reload}[raw]()
        else:
            await page.goto(self._check_url(raw), wait_until="domcontentloaded")
        return [
            {"type": "text", "text": f"Navigated to {page.url}"},
            await self.browser_state_block(),
        ]

    async def _m_screenshot(self, a: dict):
        page = self._page(a.get("tab_id"))
        png = await page.screenshot(type="png")
        return [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(png).decode(),
                },
            }
        ]

    async def _m_zoom(self, a: dict):
        page = self._page(a.get("tab_id"))
        x0, y0, x1, y1 = a["region"]
        png = await page.screenshot(
            type="png", clip={"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}
        )
        return [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64.b64encode(png).decode(),
                },
            }
        ]

    # page reading

    async def _m_read_page(self, a: dict):
        page = self._page(a.get("tab_id"))
        result = await page.evaluate(
            _REF_SCRIPT,
            {
                "filter": a.get("filter", "interactive"),
                "maxDepth": int(a.get("depth", 15)),
                "scopeRef": a.get("ref"),
            },
        )
        if result.get("error"):
            raise BrowserActionError(f"Error: {result['error']}")
        tree = result.get("tree") or "(no matching elements)"
        return f"{result.get('count', 0)} elements on {page.url}\n\n{tree}"

    async def _m_find(self, a: dict):
        page = self._page(a.get("tab_id"))
        result = await page.evaluate(
            _REF_SCRIPT, {"filter": "all", "maxDepth": 15, "scopeRef": None}
        )
        query = a.get("query") or ""
        # Queries are descriptions ("Wikipedia search input box"), not substrings
        # of the label, so score per-word instead of demanding a full match —
        # a strict `in` check sends the model back to read_page every time.
        words = [w for w in re.split(r"\W+", query.lower()) if len(w) > 2]
        scored = []
        for line in (result.get("tree") or "").splitlines():
            low = line.lower()
            score = sum(1 for w in words if w in low)
            if score:
                scored.append((score, line))
        if not scored:
            return f"No elements matching {query!r}. Try read_page for the full tree."
        scored.sort(key=lambda pair: -pair[0])
        return "\n".join(line for _, line in scored[:30])

    async def _m_get_page_text(self, a: dict):
        page = self._page(a.get("tab_id"))
        text = await page.inner_text("body")
        if len(text) > MAX_PAGE_TEXT_CHARS:
            text = text[:MAX_PAGE_TEXT_CHARS] + "\n... [truncated]"
        return text

    # pointer

    async def _click(self, a: dict, button: str, click_count: int = 1):
        page = self._page(a.get("tab_id"))
        kind, handle = await self._resolve(a.get("target"), page)
        mods = [m.capitalize() for m in (a.get("modifiers") or "").split("+") if m]
        opts = {"button": button, "click_count": click_count}
        if mods:
            opts["modifiers"] = mods
        if kind == "coordinate":
            await page.mouse.click(handle[0], handle[1], button=button, click_count=click_count)
        else:
            await handle.click(**opts)
        return "Clicked."

    async def _m_left_click(self, a: dict):
        return await self._click(a, "left")

    async def _m_right_click(self, a: dict):
        return await self._click(a, "right")

    async def _m_double_click(self, a: dict):
        return await self._click(a, "left", click_count=2)

    async def _m_middle_click(self, a: dict):
        return await self._click(a, "middle")

    async def _m_hover(self, a: dict):
        page = self._page(a.get("tab_id"))
        kind, handle = await self._resolve(a.get("target"), page)
        if kind == "coordinate":
            await page.mouse.move(handle[0], handle[1])
        else:
            await handle.hover()
        return "Hovered."

    async def _m_scroll(self, a: dict):
        page = self._page(a.get("tab_id"))
        amount = int(a.get("scroll_amount", 3)) * 100
        dx, dy = {
            "up": (0, -amount),
            "down": (0, amount),
            "left": (-amount, 0),
            "right": (amount, 0),
        }[a.get("scroll_direction", "down")]
        target = a.get("target")
        if target and target.get("type") == "coordinate":
            await page.mouse.move(target["x"], target["y"])
        await page.mouse.wheel(dx, dy)
        return "Scrolled."

    # keyboard & timing

    async def _m_type(self, a: dict):
        page = self._page(a.get("tab_id"))
        await page.keyboard.type(a.get("text", ""))
        return "Typed."

    async def _m_key(self, a: dict):
        page = self._page(a.get("tab_id"))
        combo = _translate_key(a.get("text", ""))
        for _ in range(int(a.get("repeat", 1))):
            await page.keyboard.press(combo)
        return f"Pressed {combo}."

    async def _m_hold_key(self, a: dict):
        page = self._page(a.get("tab_id"))
        combo = _translate_key(a.get("text", ""))
        await page.keyboard.down(combo)
        await asyncio.sleep(float(a.get("duration", 1)))
        await page.keyboard.up(combo)
        return f"Held {combo}."

    async def _m_wait(self, a: dict):
        await asyncio.sleep(min(float(a.get("duration", 1)), 30))
        return "Waited."

    # forms

    async def _m_form_input(self, a: dict):
        page = self._page(a.get("tab_id"))
        kind, handle = await self._resolve(a.get("target"), page)
        if kind != "locator":
            raise BrowserActionError("form_input needs a ref target, not a coordinate.")
        value = a.get("value")
        tag = (await handle.evaluate("e => e.tagName.toLowerCase()")) or ""
        if tag == "select":
            await handle.select_option(label=str(value))
        elif isinstance(value, bool):
            await handle.set_checked(value)
        else:
            await handle.fill(str(value))
        return "Set value."

    # tabs — these return ONLY a browser_state block, no text

    async def _m_new_tab(self, a: dict):
        page = await self._ctx.new_page()
        page.set_default_timeout(DEFAULT_TIMEOUT_MS)
        tab_id = self._register_tab(page)
        self._pending_state_changes.append({"type": "tab_opened", "tab_id": tab_id})
        return [await self.browser_state_block()]

    async def _m_list_tabs(self, a: dict):
        return [await self.browser_state_block()]

    async def _m_switch_tab(self, a: dict):
        tab_id = a["tab_id"]
        page = self._page(tab_id)
        await page.bring_to_front()
        self._active = tab_id
        return [await self.browser_state_block()]

    async def _m_close_tab(self, a: dict):
        tab_id = a["tab_id"]
        page = self._page(tab_id)
        await page.close()
        self._tabs.pop(tab_id, None)
        self._pending_state_changes.append({"type": "tab_closed", "tab_id": tab_id})
        if self._active == tab_id:
            self._active = next(iter(self._tabs), None)
        return [await self.browser_state_block()]

    # -- batch execution ---------------------------------------------------

    async def execute_batch(self, blocks) -> List[dict]:
        """Run one turn's member calls under the toolset's halt-on-failure contract.

        Every call gets an answer, including the ones we skip after a failure —
        dropping them silently is what teaches the model to stop batching.
        """
        results: List[dict] = []
        halted = False
        for block in blocks:
            if getattr(block, "type", None) != "tool_use":
                continue
            if getattr(block, "toolset_name", None) != TOOLSET_NAME:
                continue
            result: Dict[str, Any] = {
                "type": "tool_result",
                "tool_use_id": block.id,
                "toolset_name": TOOLSET_NAME,
            }
            if halted:
                result["content"] = "Not executed: an earlier action in this turn failed."
                result["is_error"] = True
            else:
                try:
                    result["content"] = await self.call(block.name, block.input or {})
                except BrowserActionError as err:
                    result["content"] = str(err)
                    result["is_error"] = True
                    halted = True
                except PlaywrightError as err:
                    first = str(err).split("\n")[0]
                    result["content"] = f"Error: {first}"
                    result["is_error"] = True
                    halted = True
                except Exception as err:  # noqa: BLE001 — never kill the loop
                    log.exception("browser member %s failed", block.name)
                    result["content"] = f"Error: {type(err).__name__}: {err}"
                    result["is_error"] = True
                    halted = True
            results.append(result)
        return results


class BrowserPool:
    """One Chromium process, N contexts.

    The process is the expensive part (~250-400MB); a context is ~50-100MB with
    its own cookies and storage. Concurrency is capped here rather than by
    launching more browsers.
    """

    def __init__(self, max_contexts: int = 3, headless: bool = True):
        self._max = max_contexts
        self._headless = headless
        self._pw = None
        self._browser = None
        self._sem = asyncio.Semaphore(max_contexts)
        self._lock = asyncio.Lock()

    async def _ensure(self):
        async with self._lock:
            if self._browser is None:
                self._pw = await async_playwright().start()
                self._browser = await self._pw.chromium.launch(headless=self._headless)
                log.info("browser pool: chromium launched (max %d contexts)", self._max)
        return self._browser

    async def session(self, *, storage_state=None, **kwargs) -> "BrowserSessionCtx":
        return BrowserSessionCtx(self, storage_state=storage_state, kwargs=kwargs)

    async def close(self):
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._pw:
            await self._pw.stop()
            self._pw = None


class BrowserSessionCtx:
    """Async context manager yielding a started BrowserSession, slot-limited."""

    def __init__(self, pool: BrowserPool, *, storage_state, kwargs):
        self._pool = pool
        self._storage_state = storage_state
        self._kwargs = kwargs
        self._ctx = None

    async def __aenter__(self) -> BrowserSession:
        await self._pool._sem.acquire()
        try:
            browser = await self._pool._ensure()
            self._ctx = await browser.new_context(
                viewport=VIEWPORT,
                storage_state=self._storage_state,
            )
            session = BrowserSession(self._ctx, **self._kwargs)
            await session.start()
            return session
        except Exception:
            self._pool._sem.release()
            raise

    async def __aexit__(self, *exc):
        try:
            if self._ctx:
                await self._ctx.close()
        finally:
            self._pool._sem.release()
