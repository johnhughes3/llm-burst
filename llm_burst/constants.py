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

class TabColor(str, Enum):
    """
    Named colours recognised by Chrome’s Tab Groups API.
    Values must be the lowercase strings expected by CDP.
    """
    GREY = "grey"
    BLUE = "blue"
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"
    PINK = "pink"
    PURPLE = "purple"
    CYAN = "cyan"


# Default colour choice per provider (used for automatic grouping)
DEFAULT_PROVIDER_COLORS: Final[dict[LLMProvider, TabColor]] = {
    LLMProvider.GEMINI:  TabColor.BLUE,
    LLMProvider.CLAUDE:  TabColor.YELLOW,
    LLMProvider.CHATGPT: TabColor.GREEN,
    LLMProvider.GROK:    TabColor.RED,
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
GEMINI_MODEL_NAME: Final[str] = "gemini-2.0-flash-exp"

# Environment variable for Gemini API key
GEMINI_API_KEY_ENV: Final[str] = "GEMINI_API_KEY"

# Maximum characters to extract from conversation for naming
AUTO_NAMING_MAX_CHARS: Final[int] = 10000

# Timeout for auto-naming operation (seconds)
AUTO_NAMING_TIMEOUT: Final[float] = 15.0

class RectangleAction(str, Enum):
    """
    Window-positioning actions understood by Rectangle.app.

    Values correspond to the `--action` flags accepted by *rectangle-cli*
    (when installed).  For keystroke fallback, we map each action to a
    (key, modifiers) tuple in ``RECTANGLE_KEY_BINDINGS``.
    """
    LEFT_HALF = "left-half"
    RIGHT_HALF = "right-half"
    UPPER_LEFT = "upper-left"
    UPPER_RIGHT = "upper-right"
    LOWER_LEFT = "lower-left"
    LOWER_RIGHT = "lower-right"

# Map number-of-windows → ordered list of RectangleAction operations.
# The order in which actions are executed determines the final grid
# (top-to-bottom, left-to-right for deterministic screenshots).
RECTANGLE_LAYOUTS: Final[dict[int, list[RectangleAction]]] = {
    1: [RectangleAction.LEFT_HALF],  # fall back to left-half for single window
    2: [RectangleAction.LEFT_HALF, RectangleAction.RIGHT_HALF],
    3: [
        RectangleAction.LEFT_HALF,
        RectangleAction.UPPER_RIGHT,
        RectangleAction.LOWER_RIGHT,
    ],
    4: [
        RectangleAction.UPPER_LEFT,
        RectangleAction.UPPER_RIGHT,
        RectangleAction.LOWER_LEFT,
        RectangleAction.LOWER_RIGHT,
    ],
}

# Default key + modifier mapping that matches Rectangle’s factory shortcuts.
# These will be used when rectangle-cli is unavailable.
RECTANGLE_KEY_BINDINGS: Final[dict[RectangleAction, tuple[str, str]]] = {
    RectangleAction.LEFT_HALF:  ("Left",  "ctrl+alt"),
    RectangleAction.RIGHT_HALF: ("Right", "ctrl+alt"),
    RectangleAction.UPPER_LEFT: ("Left",  "ctrl+alt+shift"),
    RectangleAction.UPPER_RIGHT:("Right", "ctrl+alt+shift"),
    RectangleAction.LOWER_LEFT: ("Left",  "ctrl+alt+cmd"),
    RectangleAction.LOWER_RIGHT:("Right", "ctrl+alt+cmd"),
}