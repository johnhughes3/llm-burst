"""Chrome process management utilities for macOS."""

from __future__ import annotations
from typing import NamedTuple, Iterable
from pathlib import Path
import os
import subprocess
import re
import time


class ChromeStatus(NamedTuple):
    """Status of Chrome processes on the system."""

    running: bool
    remote_debug: bool
    pids: tuple[int, ...]


def scan_chrome_processes(names: Iterable[str]) -> ChromeStatus:
    """
    Check if Chrome is running and whether it has remote debugging enabled.

    Parameters
    ----------
    names : Iterable[str]
        Process name patterns to search for (e.g., "Google Chrome")

    Returns
    -------
    ChromeStatus
        Status including whether Chrome is running, has remote debug, and PIDs
    """
    try:
        # Get all processes with their command lines
        result = subprocess.run(
            ["ps", "-axo", "pid,command"], capture_output=True, text=True, check=True
        )

        pids = []
        has_remote_debug = False

        for line in result.stdout.splitlines():
            # Check if this line contains any Chrome process name
            if any(name in line for name in names):
                # Extract PID (first field)
                parts = line.strip().split(None, 1)
                if len(parts) >= 2:
                    try:
                        pid = int(parts[0])
                        pids.append(pid)

                        # Check if this process has remote debugging flag
                        if re.search(r"--remote-debugging-port(?:=\d+)?", line):
                            has_remote_debug = True
                    except ValueError:
                        continue

        return ChromeStatus(
            running=bool(pids), remote_debug=has_remote_debug, pids=tuple(pids)
        )

    except (subprocess.SubprocessError, OSError):
        # If we can't scan processes, assume nothing is running
        return ChromeStatus(False, False, ())


def quit_chrome(pids: Iterable[int]) -> bool:
    """
    Gracefully quit Chrome using AppleScript, with fallback to SIGTERM.

    Parameters
    ----------
    pids : Iterable[int]
        Process IDs to terminate

    Returns
    -------
    bool
        True if Chrome was successfully quit
    """
    if not pids:
        return True

    # Graceful quit without AppleScript to avoid macOS alerts/errors.
    try:
        # First attempt: SIGTERM then SIGKILL if still running.
        for pid in pids:
            try:
                os.kill(pid, 15)  # SIGTERM
            except ProcessLookupError:
                pass
        time.sleep(2)

        # Escalate to SIGKILL where needed
        for pid in pids:
            try:
                os.kill(pid, 0)
                os.kill(pid, 9)  # SIGKILL
            except ProcessLookupError:
                pass

        time.sleep(1)
        return True
    except OSError:
        return False


def get_chrome_profile_dir() -> str:
    """
    Return the user-data directory that Chrome should use when launched with
    remote debugging enabled.

    Resolution order
    ----------------
    1. $GOOGLE_CHROME_PROFILE_DIR – explicit override.
    2. Default: ~/Library/Application Support/Google/Chrome-LLMBurst
       (A dedicated profile for llm-burst to avoid conflicts)
    """
    env_dir = os.environ.get("GOOGLE_CHROME_PROFILE_DIR")
    if env_dir:
        return os.path.expanduser(env_dir)

    # Use a dedicated profile directory for llm-burst
    # This allows remote debugging and preserves logins after initial setup
    return os.path.expanduser("~/Library/Application Support/Google/Chrome-LLMBurst")


def build_launch_args(
    port: int, profile_dir: str, extra: Iterable[str] | None = None
) -> list[str]:
    """
    Construct the argv list for launching Chrome head-fully with the required
    debugging and user-profile flags.
    """
    args = [
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--disable-background-timer-throttling",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if extra:
        args.extend(extra)
    return args


def relaunch_chrome_with_flag(port: int) -> subprocess.Popen[str]:
    """
    Launch Chrome with remote debugging enabled on the specified port.

    Uses the default user profile to preserve logins.

    Parameters
    ----------
    port : int
        Port number for remote debugging

    Returns
    -------
    subprocess.Popen
        The Chrome process handle
    """
    chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    # Check if Chrome exists at the expected location
    if not os.path.exists(chrome_path):
        raise RuntimeError(f"Chrome not found at {chrome_path}")

    # Launch Chrome with remote debugging
    # Not specifying --user-data-dir means it uses the default profile
    args = [
        chrome_path,
        f"--remote-debugging-port={port}",
        "--no-first-run",
        "--no-default-browser-check",
    ]

    return subprocess.Popen(
        args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True
    )


def launch_chrome_headful(port: int, profile_dir: Path):  # noqa: D401
    """
    Start a *head-ful* Google Chrome instance listening on *port* and using
    *profile_dir* as the user-data directory.
    """
    from pathlib import Path
    import subprocess
    import os

    # Local import to avoid circular dependency when llm_burst.browser imports us
    from llm_burst.constants import CHROME_EXECUTABLE

    # -----------------------------------------------------------------------
    # BUGFIX: build_launch_args expects a *str*, not a Path object.
    # We therefore coerce profile_dir to str in all cases.
    # -----------------------------------------------------------------------
    if isinstance(profile_dir, Path):
        profile_dir_str = str(profile_dir)
    else:
        # Accept callers passing plain strings and other path-likes
        profile_dir_str = str(profile_dir)

    flags = [
        CHROME_EXECUTABLE,
        *build_launch_args(port, profile_dir_str),
    ]

    # Spawn Chrome in the background; suppress noisy output
    return subprocess.Popen(
        flags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        env=os.environ.copy(),
    )
