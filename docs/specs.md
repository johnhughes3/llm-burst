## 0  High‑level summary

| Item                 | Decision                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Entry points**     | Keep the three Keyboard Maestro (KM) hot‑keys:<br>• **⌃⌥R** = `LLMs Activate` (new conversation)<br>• **⌃⌥F** = `LLMs Follow Up`<br>• **⌃⌥W** = `LLMs Arrange`<br>and add **⌃⌥G** = `LLMs Group/UnGroup`                                   |
| **Where KM stops**   | Each macro becomes one “Execute Shell Script” line that calls **`llm‑burst`**, passing a sub‑command (`activate`, `follow‑up`, `arrange`, `toggle‑group`).  No other KM actions remain except for reading the clipboard before `activate`. |
| **Primary browser**  | **Google Chrome** (stable `tab.id`, tab‑group APIs).  Safari adapter will be added later.                                                                                                                                                  |
| **UI layer**         | **swiftDialog** CLI (immediate win) → optional SwiftUI sheet later.                                                                                                                                                                        |
| **Automation API**   | **Playwright for Python** driving Chrome with a non‑headless window.                                                                                                                                                                       |
| **Layout / tiling**  | Use Chrome DevTools Protocol to set window bounds. `llm‑burst arrange` positions windows deterministically depending on N windows (2, 3, 4). Control via `--layout {cdp, none}` (env: `LLM_BURST_LAYOUT`, default `cdp`). |
| **State store**      | `~/.config/llm‑burst/state.json` (override with `LLM_BURST_STATE_FILE`, one JSON file, no DB).                                                                                                                                             |
| **Testing**          | Pytest + Playwright screenshots; every new feature ships with at least one failing test first (red‑green‑refactor).                                                                                                                        |
| **Delivery cadence** | 6 milestones, each < 1½ days.  The tool is always in a usable state.                                                                                                                                                                       |

---

## 1  Repository / folder layout

```
llm-burst/
├── llm_burst/                 # PYTHON PACKAGE  (import llm_burst)
│   ├── __main__.py            # parses CLI args and dispatches
│   ├── cli.py                 # Click / argparse commands
│   ├── browser.py             # BrowserAbstraction + ChromeAdapter
│   ├── sites/                 # one module per LLM website
│   │   ├── __init__.py
│   │   ├── gemini.py
│   │   ├── claude.py
│   │   ├── chatgpt.py
│   │   └── grok.py
│   ├── state.py               # load/save/upgrade JSON, prune dead sessions
│   ├── layout.py              # window arrange & tab‑group utilities (CDP)
│   ├── layout_manual.py       # CDP window-bounds helper
│   ├── auto_namer.py          # Gemini naming (suggestions/rename)
│   ├── chrome_bootstrap.py    # ensure Chrome has remote debugging enabled
│   └── constants.py
├── bin/
│   └── swift_prompt.sh        # (optional) legacy wrapper; Python calls `dialog` directly
├── tests/
│   ├── test_activate.py
│   ├── test_followup.py
│   ├── test_arrange.py
│   └── assets/                # reference screenshots
├── requirements.txt           # playwright, click, pytest, google‑generativeai …
└── README.md
```

---

## 2  Incremental milestones (T‑shirt sizes = actual dev time)

| Stage | Goal / deliverable                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Key files                                        | Size |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---- |
| **0** | **Patch selectors** & wrap each in `tryFind()` helper; keep old KM macros.                                                                                                                                                                                                                                                                                                                                                                                          | `sites/*.py` (just JS strings today)             | S    |
| **1** | **swiftDialog prompt**: huge textarea, task name, Research & Incognito check‑boxes.  KM `LLMs Activate` calls `swift_prompt.sh`, which sets KM variables then proceeds to old macro.                                                                                                                                                                                                                                                                                | `bin/swift_prompt.sh`                            | M    |
| **2** | **Chrome adapter** via Playwright CDP; JSON records `{windowId, tabId}` for each window.  KM macros still orchestrate at this stage.                                                                                                                                                                                                                                                                                         | `browser.py` (skeleton), `state.py`              | M    |
| **3** | **llm‑burst CLI (Python + Playwright)** reproduces Activate & Follow‑up end‑to‑end.  KM macros slim down to `do shell script "llm-burst activate"` etc.                                                                                                                                                                                                                                                                                                             | `__main__.py`, `cli.py`, `browser.py`, `sites/*` | L    |
| **4** | **Auto‑naming** via Gemini Flash.  Adds `title` to JSON and pregenerates default in swiftDialog.                                                                                                                                                                                                                                                                                                                                                                    | `autoname.py`, modify `swift_prompt.sh`          | S    |
| **5** | **Group / UnGroup** command:<br>• If 4 free windows ⟶ group into one Chrome Tab Group named “📁 Archived Session”.<br>• If the front window is a Tab Group created by the tool ⟶ split back into 4 windows; any tabs **between** known LLM tabs ride along with their left neighbour.<br>Includes Playwright tests that validate: “after toggle‑group, `state.json` window ids are updated.” | `layout.py`, tests                               | M    |

*After Stage 5, old AppleScript is deleted.  SafariAdapter becomes a standing backlog item.*

---

## 3  Detailed component specs

### 3.1 `browser.py`

```python
class BrowserAdapter(ABC):
    def open_llm_tab(self, model: str) -> Tuple[int, int]: ...
    def focus(self, window_id: int, tab_id: int): ...
    def execute_js(self, tab_id: int, script: str): ...
    def close(self): ...

class ChromeAdapter(BrowserAdapter):
    # uses Playwright's chromium.launch() and page.context
```

*Keep one Playwright browser **context** for all four tabs to share cookies.*

### 3.2 `sites/*`

Each module exposes:

```python
SUBMIT_JS = """/* javascript string with fallback selectors */"""
FOLLOWUP_JS = """/* similar */"""

def selectors_up_to_date(page) -> bool:
    """Quick test used by pytest; fails if site UI changed."""
```

### 3.3 `state.json` schema (v2.1)

```jsonc
{
  "schema": 2.1,
  "sessions": [
    {
      "title": "My research idea",
      "created": "2025-08-04T01:23:45Z",
      "grouped": false,
      "tabs": {
        "gemini":   {"windowId": 111, "tabId": "aaa"},
        "claude":   {"windowId": 113, "tabId": "bbb"},
        "chatgpt":  {"windowId": 115, "tabId": "ccc"},
        "grok":     {"windowId": 117, "tabId": "ddd"}
      }
    }
  ],
  "windows": [
    {
      "task_name": "GEMINI-1a2b",
      "provider": "gemini",
      "target_id": "AAA",
      "window_id": 111,
      "group_id": null,
      "page_guid": "page-guid-if-known"
    }
  ],
  "groups": [
    { "group_id": 999, "name": "Archived Session", "color": "grey" }
  ]
}
```

`state.upgrade()` auto‑migrates legacy v1 entries to v2.1.

### 3.4 `layout.py`

```python
def arrange(max_windows=4):  # CDP tiling
    arrange_cdp_sync(max_windows)

def group(session):
    # Uses CDP via Playwright: chrome.tabGroups.*

def ungroup(session):
    # Reverse of group(); respects manual extra tabs
```

CLI control:
- `llm-burst arrange --max-windows N`
- `--layout {cdp, none}` (env `LLM_BURST_LAYOUT`, default `cdp`) controls whether arrangement runs.

### 3.5 swiftDialog CLI (dialog)

`prompt_user()` calls the `dialog` binary directly using a JSON config (`--jsonfile … --json`).
- GUI prompt is off by default. Enable per-command via `--gui-prompt` or globally via `LLM_BURST_USE_DIALOG=1`.
- Force no-GUI via `LLM_BURST_NO_DIALOG=1`.
- Stderr is suppressed to avoid benign macOS LSOpen (-50) warnings; JSON is parsed from stdout.
- The legacy `bin/swift_prompt.sh` wrapper may exist, but the Python path does not depend on it.

### 3.6 CLI flags & environment

- Global
  - `-v, --verbose`: Enable verbose logging.

- `open`
  - `-p, --provider TEXT`: `gemini | claude | chatgpt | grok`.
  - `-t, --task-name TEXT`: Task name for tracking (placeholder generated if omitted).
  - `-m, --prompt-text TEXT`: Prompt text to send after opening.
  - `-s, --stdin`: Read prompt text from STDIN.
  - `-n, --new`: Force creation; fail if task already exists.
  - `-g, --group TEXT`: Chrome tab-group name (optional).
  - `--gui-prompt/--no-gui-prompt`: Show GUI dialog for missing fields (default: off).

- `activate`
  - `-t, --title TEXT`: Session title (placeholder timestamp if omitted).
  - `-m, --prompt-text TEXT`: Prompt to broadcast to all providers.
  - `-s, --stdin`: Read prompt text from STDIN.
  - `-r, --research`: Enable research/deep mode where supported.
  - `-i, --incognito`: Enable incognito/private mode where supported.
  - `-l, --layout {cdp,none}`: Window arrangement strategy (default from `LLM_BURST_LAYOUT`, default `cdp`).
  - `--gui-prompt/--no-gui-prompt`: Show GUI dialog for missing fields (default: off).

- `follow-up`
  - `-t, --title TEXT`: Session title (auto-selects when only one session).
  - `-m, --prompt-text TEXT`: Prompt text for follow-up.
  - `-s, --stdin`: Read prompt from STDIN.
  - `--gui-prompt/--no-gui-prompt`: Show GUI dialog for missing fields (default: off).

- `arrange`
  - `-m, --max-windows INT`: Maximum windows to arrange (default 4).
  - `-l, --layout {cdp,none}`: Window arrangement strategy (default `cdp`).

- `group`
  - `group list`: List tab groups.
  - `group create NAME [--color COLOR]`: Create a tab group (Chrome colors).
  - `group move TASK_NAME GROUP_NAME`: Move an existing task/tab into a group.

- Environment
  - `LLM_BURST_LAYOUT`: `cdp | none` (default `cdp`).
  - `LLM_BURST_USE_DIALOG`: `1/true/yes` to enable GUI by default.
  - `LLM_BURST_NO_DIALOG`: `1/true/yes` to force no GUI.
  - `LLM_BURST_DEBUG_DIALOG`: `1/true/yes` to keep swiftDialog stderr logs in the OS temp dir (otherwise kept only on failure).
  - `LLM_BURST_STATE_FILE`: Override state file path (default `~/.config/llm-burst/state.json`).
  - `CHROME_REMOTE_PORT`: CDP port (default 9222).
  - `GOOGLE_CHROME`: Chrome executable path override.
  - `GOOGLE_CHROME_PROFILE_DIR`: Chrome user-data dir override.
  - `LLM_BURST_AUTO_RELAUNCH_CHROME`: `1/true/yes` to auto-relaunch Chrome with the CDP port when needed.
  - `GEMINI_API_KEY`: Enables auto-namer features (optional).

---

## 4  Testing strategy

| Test file                    | Purpose                                                                                                        | What the agent must implement              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `tests/test_activate.py`     | “activate” opens 4 Chrome tabs, selectors all present, screenshots match `assets/activate_ok.png` at p90 SSIM. | Use Playwright screenshot + `pytest-ssim`. |
| `tests/test_followup.py`     | After follow‑up, each tab input area is empty and waiting for reply.                                           | DOM assertions.                            |
| `tests/test_arrange.py`      | Verifies arrange delegates to CDP and respects options.                                                       | Mocks CDP helper; optional pyobjc for manual checks. |
| `tests/test_toggle_group.py` | Group then ungroup returns to original `state.json`, window ids changed, tabs count preserved.                 | JSON diff check.                           |

Each new PR **must**:

1. Add/modify a failing test.
2. Make it pass.
3. Run `pytest -q` with all green ticks.

---

## 5  KM macro stubs (for the human installer)

```applescript
-- LLMs Activate  (⌃⌥R)
/usr/local/bin/llm-burst activate

-- LLMs Follow Up (⌃⌥F)
/usr/local/bin/llm-burst follow-up

-- LLMs Arrange    (⌃⌥W)
/usr/local/bin/llm-burst arrange

-- LLMs Group / UnGroup (⌃⌥G)
/usr/local/bin/llm-burst toggle-group
```

(If you need clipboard text inside `activate`, have KM place it in `LLMB_CLIPBOARD` env var before the shell call.)

---

## 6  Immediate next action for the coding agent

1. **Clone** empty repo, create structure in §1.
2. **Stage 0**: copy existing JS selectors into `sites/*`, wrap with `tryFind()`, add basic unit test `selectors_up_to_date` that simply calls each function. Commit.
3. Create GitHub Actions workflow that runs `pytest` on macOS‑latest with Playwright headed mode.

Once Stage 0 is merged, proceed to Stage 1, following the table in §2 exactly.
