"""llm_burst.browser
--------------------

Stage-2 Chrome adapter: connect to (or launch) a Google Chrome instance
exposing the Chrome DevTools Protocol (CDP) and provide a thin async API for
opening LLM windows.

Example
-------
>>> async with BrowserAdapter() as ba:
...     await ba.open_window("My-task", LLMProvider.GEMINI)
"""

from __future__ import annotations

import asyncio
import contextlib
import subprocess
import time
from dataclasses import dataclass
from typing import Optional

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    Error as PlaywrightError,
)

from .constants import (
    LLMProvider,
    LLM_URLS,
    CHROME_REMOTE_PORT,
    CHROME_EXECUTABLE,
)
from .state import StateManager, LiveSession

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

_CDP_BOOT_TIMEOUT = 8.0        # Seconds to wait for Chrome to expose CDP
_CDP_POLL_INTERVAL = 0.25      # Poll interval while waiting


# --------------------------------------------------------------------------- #
# Data models                                                                 #
# --------------------------------------------------------------------------- #

@dataclass(slots=True)
class SessionHandle:
    """
    Pairing of a persisted LiveSession with the live Playwright Page.

    Returned by BrowserAdapter.open_window().
    """
    live: LiveSession
    page: Page


# --------------------------------------------------------------------------- #
# Browser Adapter
# --------------------------------------------------------------------------- #

class BrowserAdapter:
    """
    Async context manager that guarantees a Playwright connection to Chrome.

    Responsibilities
    ----------------
    " Attach to an existing Chrome with remote-debugging enabled or start a new
      instance if none is found.
    " Create *top-level* windows (not mere tabs) for each LLM provider and keep
      track of their CDP target / window IDs.
    " Persist window metadata through StateManager so subsequent llm-burst
      commands can re-attach without spawning duplicates.
    """

    def __init__(self) -> None:
        self._playwright = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._chrome_proc: subprocess.Popen[str] | None = None
        self._state = StateManager()

    # ---------------- Context manager plumbing ---------------- #

    async def __aenter__(self) -> "BrowserAdapter":
        await self._ensure_connection()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        # Detach but leave Chrome running.
        if self._browser:
            await self._browser.disconnect()
        if self._playwright:
            await self._playwright.stop()

        # Reap Chrome we launched ourselves (don't kill user's existing one).
        if self._chrome_proc and self._chrome_proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                self._chrome_proc.kill()

    # ---------------- Public API ---------------- #

    async def open_window(
        self,
        task_name: str,
        provider: LLMProvider,
    ) -> SessionHandle:
        """
        Ensure a window exists for *task_name* and *provider*.

        Returns a SessionHandle which contains both the persisted metadata and
        the live Playwright Page object.
        """
        # Try re-attaching to an existing session first.
        existing = self._state.get(task_name)
        if existing:
            page = await self._find_page_for_target(existing.target_id)
            if page:
                return SessionHandle(existing, page)
            # If we cannot hydrate the Page, treat as stale and recreate.
            self._state.remove(task_name)

        # 1. Create a fresh blank browser target (top-level window).
        target_id = await self._create_blank_window()
        page = await self._find_page_for_target(target_id)
        if page is None:                    # pragma: no cover
            raise RuntimeError("Failed to obtain Playwright Page for new window")

        # 2. Navigate to the LLM landing URL.
        await page.goto(LLM_URLS[provider], wait_until="domcontentloaded")

        # 3. Determine chrome windowId for Rectangle integration.
        cdp = self._browser.contexts[0]._connection
        res = await cdp.send("Browser.getWindowForTarget", {"targetId": target_id})
        window_id = res["windowId"]

        # 4. Persist session & return handle.
        live = self._state.register(
            task_name=task_name,
            provider=provider,
            target_id=target_id,
            window_id=window_id,
            page_guid=getattr(page, "guid", None),
        )
        return SessionHandle(live, page)

    # ---------------- Internal helpers ---------------- #

    async def _ensure_connection(self) -> None:
        """Attach to an existing Chrome CDP endpoint or launch one."""
        if self._browser:
            return

        self._playwright = await async_playwright().start()
        ws_endpoint = f"ws://127.0.0.1:{CHROME_REMOTE_PORT}/devtools/browser"

        try:
            self._browser = await self._playwright.chromium.connect_over_cdp(ws_endpoint)
        except PlaywrightError:
            # No remote-debugging Chrome running  launch our own.
            self._launch_chrome_headful()
            await self._wait_for_cdp(ws_endpoint)
            self._browser = await self._playwright.chromium.connect_over_cdp(ws_endpoint)

        # Use the default user profile (index 0 in contexts)
        self._context = self._browser.contexts[0]

    def _launch_chrome_headful(self) -> None:
        """Spawn Chrome with remote-debugging enabled."""
        flags = [
            CHROME_EXECUTABLE,
            f"--remote-debugging-port={CHROME_REMOTE_PORT}",
            "--disable-background-timer-throttling",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        self._chrome_proc = subprocess.Popen(
            flags,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )

    async def _wait_for_cdp(self, ws_endpoint: str) -> None:
        """Poll until the CDP websocket becomes reachable or time out."""
        deadline = time.time() + _CDP_BOOT_TIMEOUT
        while time.time() < deadline:
            try:
                await self._playwright.chromium.connect_over_cdp(ws_endpoint)
                return
            except PlaywrightError:
                await asyncio.sleep(_CDP_POLL_INTERVAL)
        raise RuntimeError("Chrome failed to expose CDP endpoint in time")

    async def _create_blank_window(self) -> str:
        """
        Use the CDP 'Browser.createTarget' command to open a *new* top-level
        window and return its targetId.
        """
        cdp = self._browser.contexts[0]._connection
        res = await cdp.send("Browser.createTarget", {"url": "about:blank"})
        return res["targetId"]

    async def _find_page_for_target(self, target_id: str) -> Optional[Page]:
        """
        Locate a Playwright Page corresponding to *target_id*.  If the page is
        not yet represented in Playwright, attempt to attach via CDP.
        """
        # Fast path: scan existing pages.
        for context in self._browser.contexts:
            for page in context.pages:
                if getattr(page, "_target_id", None) == target_id:
                    return page

        # Slow path: attach directly via CDP to materialise a Page instance.
        try:
            context = self._browser.contexts[0]
            session = await context.new_cdp_session()
            await session.send(
                "Target.attachToTarget",
                {"targetId": target_id, "flatten": True},
            )
            await asyncio.sleep(0.1)  # give Playwright time to expose the Page
            for page in context.pages:
                if getattr(page, "_target_id", None) == target_id:
                    return page
        except Exception:             # pragma: no cover
            return None
        return None

    async def close_window(self, task_name: str) -> bool:
        """
        Close the browser window associated with *task_name*.

        Returns
        -------
        bool
            True if a window was found and closed, False otherwise.
        """
        await self._ensure_connection()

        session = self._state.get(task_name)
        if session is None:
            return False

        # Issue CDP command to close the target and clean up state
        cdp = self._browser.contexts[0]._connection
        try:
            await cdp.send("Target.closeTarget", {"targetId": session.target_id})
        finally:
            self._state.remove(task_name)
        return True

async def set_window_title(page: Page, title: str) -> None:
    """Set the tab/window title to *title* for the given Playwright Page."""
    try:
        await page.evaluate(f"document.title = {repr(title)}")
    except Exception as exc:
        import logging
        logging.getLogger(__name__).debug("Failed to set window title: %s", exc)