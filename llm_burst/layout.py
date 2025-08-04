"""llm_burst.layout
~~~~~~~~~~~~~~~~~~~~~

Stage-6: arrange ungrouped Chrome windows via Rectangle.app.

The logic is intentionally synchronous so it can be called from both sync
and async contexts (the Click CLI is synchronous).
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time
from typing import List

from .constants import RECTANGLE_LAYOUTS
from .rectangle import perform as rectangle_perform
from .state import StateManager, LiveSession

_LOG = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# macOS-specific window helpers                                               #
# --------------------------------------------------------------------------- #


def _focus_window(window_id: int) -> None:
    """Bring the Chrome window with *window_id* to the front."""
    if sys.platform != "darwin":  # pragma: no cover
        raise RuntimeError("Window focusing only supported on macOS")
    script = f"""
        tell application "Google Chrome"
            try
                set index of (first window whose id is {window_id}) to 1
                activate
            end try
        end tell
    """
    subprocess.run(
        ["osascript", "-e", script],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _ungrouped_sessions(state: StateManager) -> List[LiveSession]:
    """Return live sessions that are *not* inside a Chrome tab-group."""
    return [s for s in state.list_all().values() if s.group_id is None]


# --------------------------------------------------------------------------- #
# Public arrange() helper                                                     #
# --------------------------------------------------------------------------- #


def arrange(max_windows: int = 4) -> None:
    """Tile up to *max_windows* ungrouped LLM windows using Rectangle.app."""
    state = StateManager()
    sessions = _ungrouped_sessions(state)

    if not sessions:
        _LOG.info("No ungrouped sessions to arrange  nothing to do.")
        return

    # Respect max_windows limit
    sessions = sessions[:max_windows]

    layout = RECTANGLE_LAYOUTS.get(len(sessions))
    if layout is None:
        _LOG.warning("No predefined layout for %d window(s)", len(sessions))
        return

    # Deterministic ordering for repeatability (sorted by window_id)
    ordered_sessions = sorted(sessions, key=lambda s: s.window_id)

    _LOG.debug(
        "Applying Rectangle layout %s for %d windows", layout, len(ordered_sessions)
    )

    try:
        # Try Rectangle first
        for sess, action in zip(ordered_sessions, layout):
            _LOG.debug("-> %s with window_id=%s", action, sess.window_id)
            _focus_window(sess.window_id)
            rectangle_perform(action)
            # Slight delay ensures Rectangle processes the shortcut before focus changes
            time.sleep(0.08)
    except Exception as exc:
        # Fall back to CDP-based arrangement
        _LOG.warning("Rectangle failed (%s), trying CDP-based arrangement", exc)
        try:
            from .layout_manual import arrange_cdp_sync

            arrange_cdp_sync(max_windows)
            _LOG.info("Windows arranged using CDP")
        except Exception as cdp_exc:
            _LOG.error("CDP arrangement also failed: %s", cdp_exc)
            # Don't raise - just log the errors
