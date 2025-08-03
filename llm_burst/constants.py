"""
llm_burst.constants
-------------------

Centralised constants shared across the llm-burst code-base.
"""

from pathlib import Path
from enum import Enum, auto
from typing import Final
import os

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

# --------------------------------------------------------------------------- #
# Chrome adapter – LLM providers and default configuration
# --------------------------------------------------------------------------- #

class LLMProvider(Enum):
    """Enumeration of supported LLM web front-ends."""
    GEMINI = auto()
    CLAUDE = auto()
    CHATGPT = auto()
    GROK = auto()

# Mapping of provider → landing URL.
LLM_URLS: Final[dict[LLMProvider, str]] = {
    LLMProvider.GEMINI:  "https://gemini.google.com/app",
    LLMProvider.CLAUDE:  "https://claude.ai/new",
    LLMProvider.CHATGPT: "https://chat.openai.com",
    LLMProvider.GROK:    "https://grok.com",
}

# Default CDP remote-debugging port Chrome will listen on.
CHROME_REMOTE_PORT: Final[int] = 9222

# Path to Chrome executable (macOS default). Override via $GOOGLE_CHROME executable path if needed.
CHROME_EXECUTABLE: Final[str] = os.environ.get(
    "GOOGLE_CHROME",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)

# Location of the persistent JSON state file (override with $LLM_BURST_STATE_FILE).
STATE_FILE: Final[Path] = Path(
    os.environ.get(
        "LLM_BURST_STATE_FILE",
        Path.home() / ".config/llm-burst/state.json",
    )
)

# --------------------------------------------------------------------------- #
# Gemini API Configuration
# --------------------------------------------------------------------------- #

# Gemini model to use for auto-naming
GEMINI_MODEL_NAME: Final[str] = "gemini-1.5-flash"

# Environment variable for Gemini API key
GEMINI_API_KEY_ENV: Final[str] = "GEMINI_API_KEY"

# Maximum characters to extract from conversation for naming
AUTO_NAMING_MAX_CHARS: Final[int] = 4000

# Timeout for auto-naming operation (seconds)
AUTO_NAMING_TIMEOUT: Final[float] = 15.0