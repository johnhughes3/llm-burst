"""llm_burst.layout
~~~~~~~~~~~~~~~~~~~~~

Window arrangement via Chrome DevTools Protocol (CDP).

External window-manager integrations were removed to avoid brittle
AppleScript paths and macOS permission prompts. This module exposes a single
``arrange`` function that delegates to the CDP implementation in
``layout_manual.py``.
"""

from __future__ import annotations

import logging
import subprocess
import sys
import time
from typing import List

from .state import StateManager, LiveSession

_LOG = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# macOS-specific window helpers                                               #
# --------------------------------------------------------------------------- #

def _focus_window(window_id: int) -> None:
    """Deprecated: window focusing is no longer performed via AppleScript."""
    raise RuntimeError("Window focusing via AppleScript has been removed")


def _ungrouped_sessions(state: StateManager) -> List[LiveSession]:
    """Return live sessions that are *not* inside a Chrome tab-group."""
    return [s for s in state.list_all().values() if s.group_id is None]


# --------------------------------------------------------------------------- #
# Public arrange() helper                                                     #
# --------------------------------------------------------------------------- #


def arrange(max_windows: int = 4) -> None:
    """Arrange ungrouped LLM windows using Chrome DevTools (CDP) only."""
    from .layout_manual import arrange_cdp_sync

    try:
        arrange_cdp_sync(max_windows)
        _LOG.info("Windows arranged using CDP")
    except Exception as exc:
        # Do not attempt other strategies; simply report and continue
        _LOG.warning("CDP arrangement failed: %s", exc)
