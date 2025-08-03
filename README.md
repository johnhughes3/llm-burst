# llm-burst

A tool for burst processing with LLMs - orchestrating multiple AI chat sessions simultaneously.

## Overview

`llm-burst` replaces complex Keyboard Maestro macros with a simple Python CLI tool that:
- Opens and manages multiple LLM chat sessions (Gemini, Claude, ChatGPT, Grok)
- Arranges windows using Rectangle hotkeys
- Supports tab grouping in Chrome
- Maintains state across sessions

## Project Status

### ✅ Stage 0 - Patch Selectors (Complete)
- Extracted JavaScript selectors from KM macros
- Wrapped selectors in `tryFind()` helpers
- Created Python site modules for all LLMs
- Added basic Playwright tests
- Set up GitHub Actions CI

### ✅ Stage 1 - swiftDialog Prompt (Complete)
- Created `bin/swift_prompt.sh` wrapper script
- Captures Task Name, Prompt Text, Research mode, and Incognito mode
- Returns JSON output for Python parsing
- Integrated with `llm_burst.cli.prompt_user()` function

### 🔲 Stage 2 - Chrome Adapter
- Implement Chrome automation via Playwright
- Update state management to record browser/tab IDs

### 🔲 Stage 3 - llm-burst CLI
- Create Python CLI with Click
- Replace KM orchestration with Python

### 🔲 Stage 4 - Auto-naming
- Add Gemini Flash integration for automatic session naming

### 🔲 Stage 5 - Group/UnGroup
- Implement Chrome tab grouping functionality

## Prerequisites

- macOS (for swiftDialog and Rectangle integration)
- Python 3.11+
- swiftDialog: `brew install swiftdialog`
- Chrome browser

## Installation

```bash
# Clone the repository
git clone https://github.com/jj3ny/llm-burst.git
cd llm-burst

# Install with uv (recommended)
uv sync

# Or install with pip
pip install -e .

# Install Playwright browsers
python -m playwright install chromium
```

## Testing

```bash
# Run tests
pytest -v

# Run tests with headed browser (for debugging)
pytest -v --headed
```

## Development

See [docs/spec.md](docs/spec.md) for the full technical specification.

## License

MIT