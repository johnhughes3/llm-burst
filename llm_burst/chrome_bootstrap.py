"""
llm_burst.chrome_bootstrap
--------------------------

User-visible bootstrap that guarantees Google Chrome is running with the
`--remote-debugging-port` flag **before** any other llm-burst logic runs.

On first launch it will:

1. Inspect the current Chrome processes.
2. If Chrome is *already* exposing a CDP endpoint → return silently.
3. If Chrome is running *without* remote debugging:
   • Ask the user – via swiftDialog or a console prompt – whether to relaunch.
   • When confirmed, quit all Chrome processes and restart Chrome with the
     correct flags (same profile directory).
4. If Chrome is *not* running, do nothing – BrowserAdapter will launch its own
   instance later.

Subsequent calls are no-ops; the function is idempotent.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time

from llm_burst.constants import (
    AUTO_RELAUNCH_CHROME_ENV,
    CHROME_PROCESS_NAMES,
    CHROME_REMOTE_PORT,
    PROMPT_CANCEL_EXIT,
)
from pathlib import Path
from llm_burst.chrome_utils import (
    scan_chrome_processes,
    quit_chrome,
    get_chrome_profile_dir,
    launch_chrome_headful,
)

# --------------------------------------------------------------------------- #
# Internal helpers                                                            #
# --------------------------------------------------------------------------- #

_BOOTSTRAPPED = False  # Ensures idempotency inside one Python process


def _show_relaunch_dialog() -> bool:
    """
    Return True when the user confirms the relaunch, False otherwise.

    Preference order:
    1. swiftDialog CLI (`dialog`)
    2. Interactive console fallback
    """
    # Honour non-interactive / auto mode
    auto_env = os.getenv(AUTO_RELAUNCH_CHROME_ENV, "").lower()
    if auto_env in {"1", "true", "yes"}:
        return True

    # GUI path when `dialog` is available – call swiftDialog CLI directly
    dlg = shutil.which("dialog")
    if dlg:
        try:
            msg = (
                "llm-burst needs to restart Google Chrome with remote debugging "
                f"(port {CHROME_REMOTE_PORT}). Incognito windows will be lost."
            )
            res = subprocess.run(
                [
                    dlg,
                    "--json",
                    "--title",
                    "Enable Chrome Remote Debugging",
                    "--message",
                    msg,
                    "--button1text",
                    "Relaunch",
                    "--button1action",
                    "return",
                    "--button2text",
                    "Cancel",
                ]
            )
            return res.returncode == 0
        except Exception:
            # Any runtime failure => fall back to console prompt
            pass

    # Console fallback (best effort) – avoid blocking when no TTY
    try:
        # If there's no interactive TTY, immediately decline (lets caller handle message)
        if not sys.stdin.isatty():
            return False

        answer = input(
            "\nllm-burst needs to restart Google Chrome with remote debugging "
            f"(port {CHROME_REMOTE_PORT}). Incognito windows will be lost.\n"
            "Relaunch Chrome now? [y/N]: "
        ).strip()
        return answer.lower() in {"y", "yes"}
    except EOFError:
        # Non-interactive shell (e.g. CI, Keyboard Maestro) → decline
        return False


# --------------------------------------------------------------------------- #
# Public API                                                                  #
# --------------------------------------------------------------------------- #


def ensure_remote_debugging() -> None:
    """
    Verify Chrome is exposing a CDP endpoint and offer an automatic relaunch
    when it is not.  Exits the process with PROMPT_CANCEL_EXIT when the user
    declines the relaunch.
    """
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return

    status = scan_chrome_processes(CHROME_PROCESS_NAMES)

    # Case 1 – Chrome not running at all: nothing to do.
    if not status.running:
        _BOOTSTRAPPED = True
        return

    # Case 2 – Already OK.
    if status.remote_debug:
        _BOOTSTRAPPED = True
        return

    # Case 3 – Running without remote debugging: ask the user.
    if not _show_relaunch_dialog():
        # Provide a clear, actionable error message for non-interactive contexts
        print(
            (
                "Error: Chrome is running without --remote-debugging-port.\n"
                "LLM Burst cannot attach to an existing Chrome without this flag.\n\n"
                "Fix options:\n"
                "  1) Quit Chrome, then run: llm-burst chrome-launch\n"
                "  2) Manually start Chrome with: --remote-debugging-port=%d\n"
            )
            % CHROME_REMOTE_PORT,
            file=sys.stderr,
        )
        sys.exit(PROMPT_CANCEL_EXIT)

    print("Quitting existing Chrome instance…")
    quit_chrome(status.pids)

    print("Relaunching Chrome with remote debugging…")
    profile_dir = get_chrome_profile_dir()
    # profile_dir is a string from get_chrome_profile_dir
    launch_chrome_headful(CHROME_REMOTE_PORT, Path(profile_dir))

    # Give Chrome a chance to bind the websocket endpoint.
    time.sleep(3)

    _BOOTSTRAPPED = True
