"""Manual window arrangement using Chrome's window API via CDP."""

import asyncio
import os
import sys
from .browser import BrowserAdapter
from .state import StateManager, LiveSession
import logging

_LOG = logging.getLogger(__name__)


def _get_screen_dimensions() -> tuple[int, int, int, int]:
    """Get the primary screen's visible dimensions and origin (x, y, width, height) for CDP."""
    if sys.platform == "darwin":
        try:
            from AppKit import NSScreen

            # Get the primary screen (index 0) - this is where the menu bar is
            screens = NSScreen.screens()
            if not screens:
                raise Exception("No screens found")
            
            primary_screen = screens[0]
            frame = primary_screen.visibleFrame()
            full_frame = primary_screen.frame()

            # CDP expects top-left coordinates. macOS uses bottom-left origin.
            # We need to calculate the top-left Y coordinate of the visible frame.
            x = int(frame.origin.x)
            # Y coordinate conversion: FullHeight - (VisibleFrameOriginY + VisibleFrameHeight)
            # This gives the distance from the top of the screen to the top of the visible frame
            y = int(full_frame.size.height - (frame.origin.y + frame.size.height))
            width = int(frame.size.width)
            height = int(frame.size.height)

            return x, y, width, height
        except ImportError:
            _LOG.warning("pyobjc not available, using default dimensions")
        except Exception as e:
            _LOG.warning(f"Failed to get screen dimensions: {e}, using defaults")

    # Fallback dimensions (assuming standard 1920x1080 screen with a 25px top menu bar)
    return 0, 25, 1920, 1055


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
    """Arrange Chrome windows using CDP window bounds."""
    state = StateManager()
    sessions = [s for s in state.list_all().values() if s.group_id is None]

    if not sessions:
        _LOG.info("No ungrouped sessions to arrange")
        return

    # Limit to max_windows
    sessions = sessions[:max_windows]

    # Get screen dimensions dynamically (x, y, width, height)
    screen_x, screen_y, screen_width, screen_height = _get_screen_dimensions()

    # Define layouts for different window counts
    # Coordinates are (left, top, width, height)
    layouts = {
        1: [(screen_x, screen_y, screen_width, screen_height)],
        2: [
            (screen_x, screen_y, screen_width // 2, screen_height),
            (screen_x + screen_width // 2, screen_y, screen_width // 2, screen_height),
        ],
        3: [
            (screen_x, screen_y, screen_width // 2, screen_height // 2),
            (screen_x + screen_width // 2, screen_y, screen_width // 2, screen_height // 2),
            (screen_x, screen_y + screen_height // 2, screen_width, screen_height // 2),
        ],
        4: [
            (screen_x, screen_y, screen_width // 2, screen_height // 2),
            (screen_x + screen_width // 2, screen_y, screen_width // 2, screen_height // 2),
            (
                screen_x,
                screen_y + screen_height // 2,
                screen_width // 2,
                screen_height // 2,
            ),
            (
                screen_x + screen_width // 2,
                screen_y + screen_height // 2,
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
