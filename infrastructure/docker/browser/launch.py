"""
Keeps one headed Chromium alive inside the container, on a persistent profile,
with CDP exposed for the harness to connect to.

Launched through Playwright rather than by invoking a chromium binary directly,
so the browser is exactly the revision the harness's Playwright expects. A
version skew between the CDP client and the browser is the kind of failure that
shows up months later as one API quietly misbehaving.

Headed, not headless: the whole point of this container is that a human can
attach over VNC to log into a site by hand. Xvfb provides the display.
"""

import asyncio
import logging
import os
import signal

from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("browser-container")

PROFILE_DIR = os.environ.get("BROWSER_PROFILE_DIR", "/profile")
CDP_INTERNAL_PORT = int(os.environ.get("BROWSER_CDP_INTERNAL_PORT", "9221"))
WIDTH = int(os.environ.get("BROWSER_WIDTH", "1280"))
HEIGHT = int(os.environ.get("BROWSER_HEIGHT", "800"))
# "chrome" = real Google Chrome (installed in the image). Set BROWSER_CHANNEL=""
# to fall back to Playwright's bundled Chromium.
CHANNEL = os.environ.get("BROWSER_CHANNEL", "chrome") or None


async def main() -> None:
    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)

    async with async_playwright() as pw:
        context = await pw.chromium.launch_persistent_context(
            PROFILE_DIR,
            headless=False,
            # Real Google Chrome, not Playwright's Chromium build. Two reasons,
            # both about a HUMAN being able to sign in here by hand: Chromium
            # reports an empty navigator.userAgentData.brands, and Google's
            # sign-in refuses non-Chrome branded builds with "this browser or
            # app may not be secure". The agent never signs into anything; this
            # is purely so the login-seeding step works.
            channel=CHANNEL,
            # Playwright adds --enable-automation by default, which is what sets
            # navigator.webdriver = true. That single flag is enough for Google
            # and Facebook to block interactive sign-in. Dropping it does not
            # change what the agent can do; it only stops the browser announcing
            # itself as a test harness to sites a human is logging into.
            ignore_default_args=["--enable-automation"],
            viewport={"width": WIDTH, "height": HEIGHT},
            args=[
                "--disable-blink-features=AutomationControlled",
                # Chromium binds this to loopback and ignores
                # --remote-debugging-address; that is deliberate upstream
                # behaviour, not a flag we got wrong. A socat forwarder in this
                # container republishes it on the container interface, and
                # compose binds that to 127.0.0.1 on the host. CDP is
                # unauthenticated, so it must never reach a public interface.
                f"--remote-debugging-port={CDP_INTERNAL_PORT}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-session-crashed-bubble",
                "--hide-crash-restore-bubble",
                # Chromium's default /dev/shm is 64MB in Docker and it will
                # crash on heavy pages without this.
                "--disable-dev-shm-usage",
                f"--window-size={WIDTH},{HEIGHT}",
                "--window-position=0,0",
            ],
        )
        log.info("chromium up on CDP :%s (loopback), profile %s", CDP_INTERNAL_PORT, PROFILE_DIR)

        # A visible landing page, so someone attaching over VNC sees something
        # deliberate rather than a blank window they assume is broken.
        if not context.pages:
            await context.new_page()
        await context.pages[0].goto("about:blank")

        await stop.wait()
        log.info("shutting down")
        await context.close()


if __name__ == "__main__":
    asyncio.run(main())
