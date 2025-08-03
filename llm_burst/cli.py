"""
llm_burst.cli
-------------

CLI helpers and entry points for the llm-burst tool.

Stage-1: expose a prompt_user() function that launches the swiftDialog wrapper
and returns the user's selections as a Python dict.  Later stages will build a
Click-based interface on top of this helper.
"""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any, Dict

from .constants import (
    SWIFT_PROMPT_SCRIPT,
    PROMPT_OK_EXIT,
    PROMPT_CANCEL_EXIT,
)


def prompt_user() -> Dict[str, Any]:
    """
    Launch the swiftDialog prompt wrapper and return the user's input.

    Returns
    -------
    dict
        The JSON data produced by swiftDialog, parsed into a dictionary.

    Side Effects
    ------------
    " If the user cancels (non-zero exit code) the current process terminates
      with PROMPT_CANCEL_EXIT.
    " Any stderr emitted by the shell script is forwarded to this program's
      stderr to aid debugging.
    """
    result = subprocess.run(
        [str(SWIFT_PROMPT_SCRIPT)],
        capture_output=True,
        text=True,
    )

    # Forward any error output to the calling terminal.
    if result.stderr:
        sys.stderr.write(result.stderr)

    if result.returncode != PROMPT_OK_EXIT:
        # User cancelled or an error occurred inside the shell script.
        sys.exit(PROMPT_CANCEL_EXIT)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        # Malformed JSON is treated as an error / cancel.
        sys.stderr.write(f"Failed to parse JSON from swiftDialog: {exc}\n")
        sys.exit(PROMPT_CANCEL_EXIT)