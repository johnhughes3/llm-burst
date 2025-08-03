"""
llm_burst.constants
-------------------

Centralised constants shared across the llm-burst code-base.
"""

from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #

# Absolute path to the root of the project repository.
PACKAGE_ROOT: Path = Path(__file__).resolve().parent.parent

# Directory that houses executable helper scripts (e.g. the swiftDialog prompt).
BIN_DIR: Path = PACKAGE_ROOT / "bin"

# Full path to the swiftDialog wrapper script created in Stage 1.
SWIFT_PROMPT_SCRIPT: Path = BIN_DIR / "swift_prompt.sh"

# --------------------------------------------------------------------------- #
# User-facing defaults
# --------------------------------------------------------------------------- #

# ICU-style date-time pattern used by the original Keyboard Maestro macro:
#   %ICUDateTime%EEE, MMM d, yyyy h:mm%
# The equivalent BSD/gnu-date pattern is used inside the shell script.
KM_DATE_ICU_FORMAT: str = "%a, %b %-d, %Y %-H:%M"

# --------------------------------------------------------------------------- #
# Normalised exit codes for the prompt wrapper
# --------------------------------------------------------------------------- #

PROMPT_OK_EXIT: int = 0       # User pressed "OK"
PROMPT_CANCEL_EXIT: int = 1   # User pressed "Cancel" / closed dialog / error