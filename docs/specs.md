## 0  High‑level summary

| Item                 | Decision                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Entry points**     | Keep the three Keyboard Maestro (KM) hot‑keys:<br>• **⌃⌥R** = `LLMs Activate` (new conversation)<br>• **⌃⌥F** = `LLMs Follow Up`<br>• **⌃⌥W** = `LLMs Arrange`<br>and add **⌃⌥G** = `LLMs Group/UnGroup`                                   |
| **Where KM stops**   | Each macro becomes one “Execute Shell Script” line that calls **`llm‑burst`**, passing a sub‑command (`activate`, `follow‑up`, `arrange`, `toggle‑group`).  No other KM actions remain except for reading the clipboard before `activate`. |
| **Primary browser**  | **Google Chrome** (stable `tab.id`, tab‑group APIs).  Safari adapter will be added later.                                                                                                                                                  |
| **UI layer**         | **swiftDialog** CLI (immediate win) → optional SwiftUI sheet later.                                                                                                                                                                        |
| **Automation API**   | **Playwright for Python** driving Chrome with a non‑headless window.                                                                                                                                                                       |
| **Layout / tiling**  | Use Chrome DevTools Protocol to set window bounds. `llm‑burst arrange` positions windows deterministically depending on N windows (2, 3, 4).                                                        |
| **State store**      | `~/Library/Application Support/llm‑burst/state.json` (one JSON file, no DB).                                                                                                                                                               |
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
│   ├── layout.py              # window arrange & tab‑group utilities
│   ├── autoname.py            # Gemini Flash call
│   └── constants.py
├── bin/
│   └── swift_prompt.sh        # swiftDialog wrapper (Stage 1)
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
| **2** | **Chrome adapter** in AppleScript (temporary) + JSON now records `{browser:"chrome", windowId, tabId}`.  KM macros still orchestrate.                                                                                                                                                                                                                                                                                                                               | `browser.py` (skeleton), `state.py`              | M    |
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

### 3.3 `state.json` schema (v2)

```jsonc
{
  "schema": 2,
  "sessions": [
    {
      "title": "My research idea",
      "created": "2025-08-04T01:23:45Z",
      "browser": "chrome",
      "tabs": {
        "gemini":   {"windowId": 111, "tabId": 222},
        "claude":   {"windowId": 113, "tabId": 224},
        "chatgpt":  {"windowId": 115, "tabId": 226},
        "grok":     {"windowId": 117, "tabId": 228}
      },
      "grouped": false
    }
  ]
}
```

`state.upgrade()` auto‑migrates v1→v2.

### 3.4 `layout.py`

```python
def arrange(max_windows=4):  # CDP tiling
    arrange_cdp_sync(max_windows)

def group(session):
    # Uses CDP via Playwright: chrome.tabGroups.*

def ungroup(session):
    # Reverse of group(); respects manual extra tabs
```

### 3.5 swiftDialog wrapper (`bin/swift_prompt.sh`)

*Parses dialog output of the form `Label : Value` and sets environment variables for KM or directly prints JSON for `llm‑burst activate --stdin-json`.*

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
