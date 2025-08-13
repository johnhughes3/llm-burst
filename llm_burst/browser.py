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
# Helper functions
# --------------------------------------------------------------------------- #

def bring_chrome_to_front() -> None:
    """Bring Chrome to the foreground on macOS using AppleScript."""
    try:
        # Use osascript to activate Chrome
        subprocess.run(
            ["osascript", "-e", 'tell application "Google Chrome" to activate'],
            capture_output=True,
            timeout=2
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
        # Best effort - don't fail if this doesn't work
        pass

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
            None  # Cached Playwright CDPSession (prefer browser-level session)
        )
        self._state = StateManager()
        self._tab_groups_supported: bool | None = None
        # Track the remote debugging port we actually connect to; start with configured default
        self._remote_port: int = CHROME_REMOTE_PORT

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

    async def prune_stale_sessions(self) -> int:
        """
        Identify and remove sessions from state that no longer have corresponding
        browser windows/tabs open.

        Returns the number of sessions/tabs pruned.
        """
        await self._ensure_connection()
        if not self._browser:
            return 0

        # 1. Get all live target IDs from Chrome via CDP
        cdp = await self._get_cdp_connection()
        if not cdp:
            return 0

        try:
            # Target.getTargets returns info about all pages, workers, etc.
            targets_response = await cdp.send("Target.getTargets")
            live_target_ids = {
                t["targetId"]
                for t in targets_response.get("targetInfos", [])
                if t.get("type") == "page"
            }
        except Exception as e:
            import logging

            logging.getLogger(__name__).error(
                "Failed to retrieve live targets via CDP: %s", e
            )
            return 0

        # 2. Compare with stored state and prune
        pruned_count = 0
        import logging

        _LOG = logging.getLogger(__name__)

        # Prune LiveSessions (v1/per-tab)
        all_sessions = self._state.list_all()
        for task_name, session in all_sessions.items():
            if session.target_id not in live_target_ids:
                _LOG.info(
                    "Pruning stale LiveSession: %s (target %s)",
                    task_name,
                    session.target_id,
                )
                self._state.remove(task_name)
                pruned_count += 1

        # Prune MultiProviderSessions (v2/session-level)
        all_multi_sessions = self._state.list_sessions()
        for session_title, multi_session in all_multi_sessions.items():
            alive_tabs = {}
            for provider, tab_handle in multi_session.tabs.items():
                if tab_handle.tab_id in live_target_ids:
                    alive_tabs[provider] = tab_handle
                else:
                    _LOG.info(
                        "Pruning stale tab in MultiProviderSession %s: %s (target %s)",
                        session_title,
                        provider.name,
                        tab_handle.tab_id,
                    )

            if not alive_tabs:
                # If no tabs remain for this session, remove the whole session
                _LOG.info(
                    "Pruning stale MultiProviderSession: %s (no live tabs)",
                    session_title,
                )
                self._state.remove_session(session_title)
            elif len(alive_tabs) != len(multi_session.tabs):
                # Update session with only alive tabs
                self._state.update_session_tabs(session_title, alive_tabs)

        if pruned_count > 0:
            self._state.persist_now()

        return pruned_count

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

        # 2. Navigate to the LLM landing URL. Avoid 'networkidle' which can hang on dynamic sites.
        await page.goto(LLM_URLS[provider], wait_until="load")

        # 3. Determine chrome windowId for window arrangement integration.
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

    async def open_tab_in_window(
        self,
        task_name: str,
        provider: LLMProvider,
        opener_target_id: str,
    ) -> SessionHandle:
        """
        Open a new tab in the same Chrome window as the target specified by
        *opener_target_id*, navigate to the provider URL, and persist metadata.

        Returns a SessionHandle.
        """
        await self._ensure_connection()

        # Try re-attaching to an existing session first.
        existing = self._state.get(task_name)
        if existing:
            page = await self._find_page_for_target(existing.target_id)
            if page:
                return SessionHandle(existing, page)
            # If we cannot hydrate the Page, treat as stale and recreate.
            self._state.remove(task_name)

        # 1) Create a new tab using the opener target to keep it in the same window
        target_id = await self._create_tab_in_window(opener_target_id)
        page = await self._find_page_for_target(target_id)
        if page is None:  # pragma: no cover
            raise RuntimeError("Failed to obtain Playwright Page for new tab")

        # 2) Navigate to the LLM landing URL
        await page.goto(LLM_URLS[provider], wait_until="load")

        # 3) Resolve window id for this new tab
        cdp = await self._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")
        try:
            res = await cdp.send("Browser.getWindowForTarget", {"targetId": target_id})
        except Exception:
            res = {"windowId": 1}
        window_id = res["windowId"]

        # 4) Persist session & return handle
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
                f"Unable to connect to Chrome remote debugging on port {self._remote_port}. "
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
        """Fetch the WebSocket debugger URL from Chrome's /json/version endpoint.

        Tries the currently configured port, and if unreachable, attempts to
        auto-detect the active remote debugging port from running Chrome
        processes.
        """
        import aiohttp

        async def fetch(port: int) -> str | None:
            url = f"http://127.0.0.1:{port}/json/version"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        url, timeout=aiohttp.ClientTimeout(total=2)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            return data.get("webSocketDebuggerUrl")
            except Exception:
                return None

        # 1) Try current port
        ws = await fetch(self._remote_port)
        if ws:
            return ws

        # 2) Attempt to auto-detect a different port from Chrome processes
        try:
            from .chrome_utils import scan_chrome_processes
            status = scan_chrome_processes(CHROME_PROCESS_NAMES)
            if status.running and status.remote_debug and status.debug_port:
                if status.debug_port != self._remote_port:
                    self._remote_port = status.debug_port
                    ws = await fetch(self._remote_port)
                    if ws:
                        return ws
        except Exception:
            pass

        return None

    def _launch_chrome_headful(self) -> None:
        """Spawn a dedicated Chrome instance with remote-debugging enabled."""
        if self._chrome_proc is not None:
            return  # already launched by this adapter

        # Resolve the user-data directory we will pass to Chrome.
        from pathlib import Path
        from .chrome_utils import launch_chrome_headful

        profile_dir = get_chrome_profile_dir()
        self._user_data_dir = profile_dir  # Remember for potential cleanup

        # Delegate actual spawn to shared helper
        self._chrome_proc = launch_chrome_headful(CHROME_REMOTE_PORT, Path(profile_dir))

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

    async def _create_tab_in_window(self, opener_target_id: str) -> str:
        """
        Create a new browser tab in the same window as *opener_target_id* and
        return the new targetId.

        Implementation detail: use Target.createTarget with the 'openerId'
        bound to the provided target. Chrome opens the new target in the same
        window as the opener.
        """
        cdp = await self._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")
        params = {
            "url": "about:blank",
            "newWindow": False,
            "background": False,
            "openerId": opener_target_id,
        }
        res = await cdp.send("Target.createTarget", params)
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

        # Preferred: create a browser-level CDP session when available.
        # Some CDP domains (e.g. TabGroups) are only exposed at the browser level.
        if self._browser and hasattr(self._browser, "new_browser_cdp_session"):
            try:
                self._cdp_session = await self._browser.new_browser_cdp_session()  # type: ignore[attr-defined]
                return self._cdp_session
            except Exception:
                # Fall through to page-anchored session if browser-level session fails
                pass

        # Fallback: use a page-anchored CDP session.
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

        # Robust detection via schema listing; fall back to probing if needed.
        try:
            doms = await cdp.send("Schema.getDomains")
            names = {d.get("name") for d in (doms or {}).get("domains", [])}
            self._tab_groups_supported = "TabGroups" in names
            if self._tab_groups_supported:
                return
        except Exception:
            # Ignore and try probing directly
            pass

        try:
            # Direct probe: expect either success or a deterministic "method not found" error
            await cdp.send("TabGroups.get", {"groupId": -1})
            self._tab_groups_supported = True
        except PlaywrightError as exc:
            msg = str(exc).lower()
            if "methodnotfound" in msg or "wasn't found" in msg or "wasnt found" in msg:
                self._tab_groups_supported = False
            else:
                # Any other error implies the domain exists but parameters were invalid
                self._tab_groups_supported = True
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

    async def _update_group_title(self, group_id: int, title: str) -> None:
        """Best-effort update of a tab group's title (no-op on unsupported builds)."""
        if not self._tab_groups_supported:
            return
        cdp = await self._get_cdp_connection()
        if not cdp:
            return
        try:
            await cdp.send("TabGroups.update", {"groupId": group_id, "title": title})
        except Exception:
            # Ignore if the method is not available on this Chrome build
            pass

    async def pick_existing_window_opener(self) -> Optional[tuple[str, int]]:
        """
        Return a (targetId, windowId) pair for any existing, visible page target.

        Used to open the first provider as a tab in the user's current window
        rather than creating a new window in --tabs mode.
        """
        await self._ensure_connection()
        cdp = await self._get_cdp_connection()
        if not cdp:
            return None
        try:
            res = await cdp.send("Target.getTargets")
            for ti in res.get("targetInfos", []):
                if ti.get("type") != "page":
                    continue
                url = (ti.get("url") or "").lower()
                if url.startswith("devtools://") or url.startswith("chrome://"):
                    continue
                target_id = ti.get("targetId")
                if not target_id:
                    continue
                win = await cdp.send("Browser.getWindowForTarget", {"targetId": target_id})
                return target_id, win.get("windowId", 1)
        except Exception:
            pass
        return None

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
