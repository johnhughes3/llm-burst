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
import os
from dataclasses import dataclass
from typing import Optional

from playwright.async_api import (
    async_playwright,
    Browser,
    BrowserContext,
    Page,
    Error as PlaywrightError,
)

from .chrome_utils import (
    scan_chrome_processes,
    quit_chrome,
    get_chrome_profile_dir,
    build_launch_args,
)
from .constants import (
    LLMProvider,
    LLM_URLS,
    CHROME_REMOTE_PORT,
    CHROME_EXECUTABLE,
    CHROME_PROCESS_NAMES,
    AUTO_RELAUNCH_CHROME_ENV,
)
from .state import StateManager, LiveSession

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

_CDP_BOOT_TIMEOUT = 8.0  # Seconds to wait for Chrome to expose CDP
_CDP_POLL_INTERVAL = 0.25  # Poll interval while waiting
_PAGE_DISCOVERY_TIMEOUT = 4.0  # Max seconds to wait for Playwright Page materialisation


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
        self._user_data_dir: str | None = None  # Temp profile dir for dedicated Chrome
        self._cdp_session = (
            None  # Cached Playwright CDPSession for Browser-domain commands
        )
        self._state = StateManager()
        self._tab_groups_supported: bool | None = None

    # ---------------- Context manager plumbing ---------------- #

    async def __aenter__(self) -> "BrowserAdapter":
        await self._ensure_connection()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        # Detach but leave Chrome running.
        if self._browser:
            # CDP-connected browsers use close() instead of disconnect()
            if hasattr(self._browser, "disconnect"):
                await self._browser.disconnect()
            else:
                await self._browser.close()
        if self._playwright:
            await self._playwright.stop()

        # Reap Chrome we launched ourselves
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
        if page is None:  # pragma: no cover
            raise RuntimeError("Failed to obtain Playwright Page for new window")

        # 2. Navigate to the LLM landing URL.
        await page.goto(LLM_URLS[provider], wait_until="domcontentloaded")

        # 3. Determine chrome windowId for Rectangle integration.
        cdp = await self._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")
        # Try to get window ID, fallback to a default if not available
        try:
            res = await cdp.send("Browser.getWindowForTarget", {"targetId": target_id})
        except Exception:
            # Browser.getWindowForTarget may not be available, use default window ID
            res = {"windowId": 1}
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
        """Attach to an existing CDP endpoint or launch/relaunch Chrome."""

        if self._browser:
            return  # Already connected

        self._playwright = await async_playwright().start()

        # 1️⃣ First attempt – connect to any Chrome already exposing CDP
        ws_endpoint = await self._get_websocket_endpoint()
        if ws_endpoint:
            try:
                self._browser = await self._playwright.chromium.connect_over_cdp(
                    ws_endpoint
                )
            except PlaywrightError:
                ws_endpoint = None  # Could not connect

        # Early success
        if self._browser:
            self._context = self._browser.contexts[0]
            await self._probe_tab_groups()
            return

        # 2️⃣ No CDP yet – inspect local Chrome processes
        status = scan_chrome_processes(CHROME_PROCESS_NAMES)

        if status.running and not status.remote_debug:
            # Chrome is running but **without** remote debugging
            auto = os.getenv(AUTO_RELAUNCH_CHROME_ENV, "").lower() in {
                "1",
                "true",
                "yes",
            }
            if not auto:
                raise RuntimeError(
                    "Google Chrome is currently running without the "
                    f"'--remote-debugging-port={CHROME_REMOTE_PORT}' flag.\n\n"
                    "Either quit Chrome completely and restart it with that flag, e.g.\n"
                    f"  {CHROME_EXECUTABLE} --remote-debugging-port={CHROME_REMOTE_PORT}\n\n"
                    f"Or set the environment variable {AUTO_RELAUNCH_CHROME_ENV}=1 and "
                    "llm-burst will perform the restart automatically."
                )

            # Auto-relaunch path
            print("Quitting existing Chrome instance...")
            quit_chrome(status.pids)
            print("Launching Chrome with remote debugging...")
            self._launch_chrome_headful()
            # Give Chrome extra time to start with existing profile
            await asyncio.sleep(3)

        elif not status.running:
            # No Chrome at all – launch a dedicated instance
            self._launch_chrome_headful()
        else:
            # Chrome claims to run with remote debug but connection failed → port mismatch?
            raise RuntimeError(
                f"Unable to connect to Chrome remote debugging on port {CHROME_REMOTE_PORT}. "
                "Verify the port or set $CHROME_REMOTE_PORT to match the running instance."
            )

        # 3️⃣ Wait for the freshly launched Chrome to expose CDP and connect
        deadline = time.time() + _CDP_BOOT_TIMEOUT
        while time.time() < deadline:
            ws_endpoint = await self._get_websocket_endpoint()
            if ws_endpoint:
                try:
                    self._browser = await self._playwright.chromium.connect_over_cdp(
                        ws_endpoint
                    )
                    break
                except PlaywrightError:
                    pass
            await asyncio.sleep(_CDP_POLL_INTERVAL)

        if not self._browser:
            raise RuntimeError(
                "Chrome failed to expose a CDP endpoint in time after relaunch."
            )

        # Default context and one-time capability probe
        self._context = self._browser.contexts[0]
        await self._probe_tab_groups()

    async def _get_websocket_endpoint(self) -> str | None:
        """Fetch the WebSocket debugger URL from Chrome's /json/version endpoint."""
        import aiohttp

        url = f"http://127.0.0.1:{CHROME_REMOTE_PORT}/json/version"
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url, timeout=aiohttp.ClientTimeout(total=2)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get("webSocketDebuggerUrl")
        except Exception:
            pass
        return None

    def _launch_chrome_headful(self) -> None:
        """Spawn a dedicated Chrome instance with remote-debugging enabled."""
        if self._chrome_proc is not None:
            return  # already launched by this adapter

        # Resolve the user-data directory we will pass to Chrome.
        from .chrome_utils import launch_chrome_headful, get_chrome_profile_dir

        profile_dir = get_chrome_profile_dir()
        self._user_data_dir = profile_dir  # Remember for potential cleanup

        # Delegate actual spawn to shared helper
        self._chrome_proc = launch_chrome_headful(CHROME_REMOTE_PORT, profile_dir)

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
        cdp = await self._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")
        res = await cdp.send(
            "Target.createTarget", {"url": "about:blank", "newWindow": True}
        )
        return res["targetId"]

    async def _find_page_for_target(self, target_id: str) -> Optional[Page]:
        """
        Locate (and, if needed, materialise) a Playwright Page that belongs to
        the supplied *target_id*.

        Strategy
        --------
        1. Iterate over every known Page and open a one-shot CDP session for
           that page via ``context.new_cdp_session(page)``.
        2. Call ``Target.getTargetInfo`` (no params) – Chrome returns the
           *targetInfo* for the page the session is attached to, including
           ``targetId``.
        3. Compare against *target_id* and return the first match found.
        4. If the page hasn't materialised yet, perform a single
           ``Target.attachToTarget`` to nudge Playwright and keep polling until
           `_PAGE_DISCOVERY_TIMEOUT` elapses.
        """
        if not self._browser:
            return None

        deadline = time.time() + _PAGE_DISCOVERY_TIMEOUT
        attach_attempted = False

        while time.time() < deadline:
            for context in self._browser.contexts:
                for page in context.pages:
                    try:
                        # One-shot session just for identification
                        cdp_sess = await context.new_cdp_session(page)
                        info = await cdp_sess.send("Target.getTargetInfo")
                        # getTargetInfo returns {'targetInfo': {...}} on modern Chrome
                        ti = info.get("targetInfo") if isinstance(info, dict) else None
                        if (ti or info).get("targetId") == target_id:
                            return page
                    except Exception:
                        # Ignore pages that vanish or fail; continue scanning
                        pass

            # Teach Playwright about the target once, then continue polling
            if not attach_attempted and self._browser.contexts:
                try:
                    base_ctx = self._browser.contexts[0]
                    anchor_page: Optional[Page] = (
                        base_ctx.pages[0]
                        if base_ctx.pages
                        else await base_ctx.new_page()
                    )
                    anchor_sess = await base_ctx.new_cdp_session(anchor_page)
                    await anchor_sess.send(
                        "Target.attachToTarget",
                        {"targetId": target_id, "flatten": True},
                    )
                except Exception:
                    pass
                finally:
                    attach_attempted = True

            await asyncio.sleep(_CDP_POLL_INTERVAL)

        # Timed out – caller will treat as failure and recreate
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
        cdp = await self._get_cdp_connection()
        if not cdp:
            return False
        try:
            await cdp.send("Target.closeTarget", {"targetId": session.target_id})
        finally:
            self._state.remove(task_name)
        return True

    async def _get_cdp_connection(self):
        """
        Return a Playwright CDPSession suitable for Browser.* commands.

        Strategy
        --------
        1. If we already created a CDP session and it is still live, reuse it.
        2. Otherwise pick (or create) the first page in the default context and
           attach a new CDP session to that page.  Cache the result for later.
        """
        # Re-use existing, still-open session
        if self._cdp_session and not getattr(self._cdp_session, "_disposed", False):
            return self._cdp_session

        # Resolve an operational BrowserContext
        context = self._context
        if context is None and self._browser and self._browser.contexts:
            context = self._browser.contexts[0]
        if context is None:
            return None  # Browser not ready yet

        # Pick a page to anchor the CDP session
        page_for_session: Optional[Page] = context.pages[0] if context.pages else None
        if page_for_session is None:
            try:
                page_for_session = await context.new_page()
            except Exception:
                return None  # Could not create a page → give up

        # Establish and cache the session
        try:
            self._cdp_session = await context.new_cdp_session(page_for_session)
            return self._cdp_session
        except Exception:
            return None

    async def _probe_tab_groups(self) -> None:
        """Set self._tab_groups_supported based on CDP capability."""
        if self._tab_groups_supported is not None:
            return  # already probed

        cdp = await self._get_cdp_connection()
        if not cdp:
            self._tab_groups_supported = False
            return

        try:
            await cdp.send("TabGroups.get", {"groupId": -1})
            self._tab_groups_supported = True
        except PlaywrightError as exc:
            if "methodNotFound" in str(exc):
                self._tab_groups_supported = False
            else:
                self._tab_groups_supported = True  # assume true for other errors
        except Exception:
            self._tab_groups_supported = False

    async def _get_or_create_group(self, name: str, color: str, window_id: int) -> int:
        """
        Return an existing Chrome groupId for *name* or create a fresh one.
        Persists metadata via StateManager.
        """
        existing = self._state.get_group_by_name(name)
        if existing:
            return existing.group_id

        if not self._tab_groups_supported:
            raise RuntimeError("Chrome build lacks Tab Groups API")

        cdp = await self._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")

        res = await cdp.send(
            "TabGroups.create",
            {"windowId": window_id, "title": name, "color": color},
        )
        group_id = res["groupId"]
        self._state.register_group(group_id, name, color)
        return group_id

    async def _add_target_to_group(self, target_id: str, group_id: int) -> None:
        """Add a CDP target (tab) to *group_id*."""
        if not self._tab_groups_supported:
            return

        cdp = await self._get_cdp_connection()
        if not cdp:
            return  # No CDP available
        await cdp.send("TabGroups.addTab", {"groupId": group_id, "tabId": target_id})

    async def move_task_to_group(self, task_name: str, group_name: str) -> None:
        """
        Move an existing llm-burst task/tab into the specified tab group.
        The group is created if it does not already exist.
        """
        await self._ensure_connection()

        session = self._state.get(task_name)
        if session is None:
            raise RuntimeError(f"No active session named '{task_name}'")

        if not self._tab_groups_supported:
            raise RuntimeError("Chrome build lacks Tab Groups API")

        # Resolve colour automatically from provider when unknown
        from .constants import DEFAULT_PROVIDER_COLORS

        default_colour = DEFAULT_PROVIDER_COLORS.get(session.provider)
        colour_str = default_colour.value if default_colour else "grey"

        group_id = await self._get_or_create_group(
            group_name, colour_str, session.window_id
        )
        await self._add_target_to_group(session.target_id, group_id)
        self._state.assign_session_to_group(task_name, group_id)


async def set_window_title(page: Page, title: str) -> None:
    """Set the tab/window title to *title* for the given Playwright Page."""
    try:
        await page.evaluate(f"document.title = {repr(title)}")
    except Exception as exc:
        import logging

        logging.getLogger(__name__).debug("Failed to set window title: %s", exc)
