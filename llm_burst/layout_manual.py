"""Manual window arrangement using Chrome's window API via CDP."""

import asyncio
import os
from .browser import BrowserAdapter
from .state import StateManager, LiveSession
import logging

_LOG = logging.getLogger(__name__)


async def _verify_bounds(
    cdp, session: LiveSession, expected: tuple[int, int, int, int]
) -> None:
    """
    Fetch the current window bounds and log a warning when deviation exceeds
    10 pixels in any direction.  Enabled only when $LLM_BURST_DEBUG_BOUNDS=1.
    """
    if os.getenv("LLM_BURST_DEBUG_BOUNDS", "0") not in {"1", "true", "yes"}:
        return

    try:
        res = await cdp.send("Browser.getWindowBounds", {"windowId": session.window_id})
        bounds = res.get("bounds", {})
        actual = (
            bounds.get("left", -1),
            bounds.get("top", -1),
            bounds.get("width", -1),
            bounds.get("height", -1),
        )
        tolerance = 10
        if any(abs(a - e) > tolerance for a, e in zip(actual, expected)):
            _LOG.warning(
                "Window %s bounds off by >%dpx – expected %s, got %s",
                session.window_id,
                tolerance,
                expected,
                actual,
            )
    except Exception as exc:
        _LOG.debug(
            "Bounds verification failed for window %s: %s", session.window_id, exc
        )


async def arrange_via_cdp(max_windows: int = 4) -> None:
    """Arrange Chrome windows using CDP window bounds instead of Rectangle."""
    state = StateManager()
    sessions = [s for s in state.list_all().values() if s.group_id is None]

    if not sessions:
        _LOG.info("No ungrouped sessions to arrange")
        return

    # Limit to max_windows
    sessions = sessions[:max_windows]

    # Get screen dimensions (approximate for standard displays)
    screen_width = 1920  # You could make this configurable
    screen_height = 1080
    menu_bar_height = 25

    # Define layouts for different window counts
    layouts = {
        1: [(0, menu_bar_height, screen_width, screen_height)],
        2: [
            (0, menu_bar_height, screen_width // 2, screen_height),
            (screen_width // 2, menu_bar_height, screen_width // 2, screen_height),
        ],
        3: [
            (0, menu_bar_height, screen_width // 2, screen_height // 2),
            (screen_width // 2, menu_bar_height, screen_width // 2, screen_height // 2),
            (0, menu_bar_height + screen_height // 2, screen_width, screen_height // 2),
        ],
        4: [
            (0, menu_bar_height, screen_width // 2, screen_height // 2),
            (screen_width // 2, menu_bar_height, screen_width // 2, screen_height // 2),
            (
                0,
                menu_bar_height + screen_height // 2,
                screen_width // 2,
                screen_height // 2,
            ),
            (
                screen_width // 2,
                menu_bar_height + screen_height // 2,
                screen_width // 2,
                screen_height // 2,
            ),
        ],
    }

    layout = layouts.get(len(sessions))
    if not layout:
        _LOG.warning(f"No layout defined for {len(sessions)} windows")
        return

    # Sort sessions for consistent ordering
    ordered_sessions = sorted(sessions, key=lambda s: s.window_id)

    async with BrowserAdapter() as adapter:
        cdp = await adapter._get_cdp_connection()
        if not cdp:
            _LOG.error("No CDP connection available for window arrangement")
            return

        for session, (x, y, width, height) in zip(ordered_sessions, layout):
            try:
                # Use CDP to set window bounds
                await cdp.send(
                    "Browser.setWindowBounds",
                    {
                        "windowId": session.window_id,
                        "bounds": {
                            "left": x,
                            "top": y,
                            "width": width,
                            "height": height,
                            "windowState": "normal",
                        },
                    },
                )
                await _verify_bounds(cdp, session, (x, y, width, height))
                _LOG.debug(
                    f"Positioned window {session.window_id} to ({x}, {y}, {width}x{height})"
                )
                await asyncio.sleep(0.1)  # Small delay between moves
            except Exception as e:
                _LOG.error(f"Failed to position window {session.window_id}: {e}")


def arrange_cdp_sync(max_windows: int = 4) -> None:
    """Synchronous wrapper for CDP-based arrangement."""
    asyncio.run(arrange_via_cdp(max_windows))
