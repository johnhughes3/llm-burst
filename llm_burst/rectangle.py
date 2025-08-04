"""llm_burst.rectangle
~~~~~~~~~~~~~~~~~~~~~~~~

Utility helpers for issuing window-tiling commands to Rectangle.app.

Execution strategy (in order of preference):
1. Call the standalone *rectangle-cli* binary if present.
2. Fallback: simulate the stock Rectangle keyboard shortcuts via AppleScript.

Both approaches are macOS-only.  A RuntimeError is raised on other platforms.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from typing import Final

from .constants import (
    RectangleAction,
    RECTANGLE_KEY_BINDINGS,
)

_LOG = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Internal helpers                                                            #
# --------------------------------------------------------------------------- #


def _has_rectangle_cli() -> bool:
    """Return True when the rectangle-cli executable is found on PATH."""
    return shutil.which("rectangle-cli") is not None


def _run_rectangle_cli(action: RectangleAction) -> None:
    """Invoke *rectangle-cli* for *action*.  Raises on non-zero exit."""
    cli_path: Final[str] = shutil.which("rectangle-cli")  # type: ignore[assignment]
    if not cli_path:  # pragma: no cover
        raise RuntimeError("rectangle-cli not found on PATH")
    subprocess.run(
        [cli_path, "--action", action.value], check=True, capture_output=True
    )


# --------------------------- AppleScript fallback -------------------------- #


def _apple_key_expr(key: str) -> str:
    """Return AppleScript snippet for the given *key* identifier."""
    # Map key names to their macOS key codes
    keycodes = {
        "left": 123,
        "right": 124,
        "up": 126,
        "down": 125,
        "u": 32,
        "i": 34,
        "j": 38,
        "k": 40,
    }
    low = key.lower()
    if low in keycodes:
        return f"key code {keycodes[low]}"
    # Fallback to literal keystroke – enclose in quotes
    return f'keystroke "{key}"'


def _modifiers_list(mod_string: str) -> str:
    """Convert a 'ctrl+alt' style string into AppleScript modifiers list."""
    mapping = {
        "ctrl": "control down",
        "control": "control down",
        "alt": "option down",
        "option": "option down",
        "cmd": "command down",
        "command": "command down",
        "shift": "shift down",
    }
    parts = [mapping[p] for p in mod_string.split("+") if p]
    return ", ".join(parts)


def _send_applescript_keystroke(action: RectangleAction) -> None:
    """Simulate the Rectangle keyboard shortcut for *action*."""
    if sys.platform != "darwin":  # pragma: no cover
        raise RuntimeError("AppleScript fallback only available on macOS")
    key, mods = RECTANGLE_KEY_BINDINGS[action]
    mod_list = _modifiers_list(mods)
    key_expr = _apple_key_expr(key)
    script = (
        'tell application "System Events" to '  # noqa: E501
        f"{key_expr} using {{{mod_list}}}"
    )
    subprocess.run(["osascript", "-e", script], check=True)


# --------------------------------------------------------------------------- #
# Public API                                                                  #
# --------------------------------------------------------------------------- #


def perform(action: RectangleAction) -> None:
    """Execute *action* using Rectangle.app via CLI or keystroke fallback."""
    try:
        if _has_rectangle_cli():
            _run_rectangle_cli(action)
            return
    except Exception as exc:  # pragma: no cover
        _LOG.debug("rectangle-cli path detected but failed to run: %s", exc)

    # Fallback path
    _send_applescript_keystroke(action)
