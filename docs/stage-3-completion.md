# Stage 3: Click CLI Interface - COMPLETED ✅

## Summary
Stage 3 successfully implemented a comprehensive Click-based command-line interface for orchestrating multiple LLM browser sessions. The implementation provides user-friendly commands for listing, opening, and stopping LLM windows with support for all four providers.

## Components Delivered

### 1. Click CLI (`llm_burst/cli_click.py`)
- **Main CLI group**: Root command with verbose logging and version options
- **list command**: Display active sessions in table or JSON format
- **open command**: Launch LLM windows with flexible input options
- **stop command**: Close single, multiple, or all sessions
- **SwiftDialog integration**: Falls back to GUI prompt for missing values

### 2. Provider Modules (`llm_burst/providers/`)
- **Registry pattern**: Decorator-based registration for extensibility
- **Provider implementations**: Gemini, Claude, ChatGPT, Grok
- **Accurate selectors**: Extracted from original KM macros
- **Async prompt injection**: Page interaction with proper wait conditions

### 3. CLI Bridge Functions (`llm_burst/cli.py`)
- **send_prompt_sync()**: Inject text into existing sessions
- **close_llm_window_sync()**: Close browser windows
- **Async wrappers**: Bridge sync CLI to async browser operations

### 4. Browser Enhancements (`llm_burst/browser.py`)
- **close_window()**: CDP Target.closeTarget integration
- **State cleanup**: Automatic removal on window close

### 5. Entry Point (`llm_burst/__main__.py`)
- Package executable via `python -m llm_burst`
- Clean delegation to Click CLI

## Key Features

### Command Structure
```bash
llm-burst [OPTIONS] COMMAND [ARGS]

Commands:
  list  List running LLM sessions
  open  Open a new LLM window (or re-attach) and optionally send a prompt
  stop  Close one or more running LLM windows

Options:
  -v, --verbose  Enable verbose logging
  --version      Show the version and exit
```

### Open Command Options
```bash
llm-burst open [OPTIONS]
  -p, --provider TEXT     LLM provider: gemini, claude, chatgpt, grok
  -t, --task-name TEXT    Task name for tracking
  -m, --prompt-text TEXT  Prompt text to send after opening
  -s, --stdin             Read prompt text from STDIN
  -r, --reuse             Fail if task-name already exists
```

### List Command Formats
```bash
# Table view (default)
llm-burst list

# JSON output for scripting
llm-burst list --output json
```

### Stop Command Targets
```bash
# Stop specific tasks
llm-burst stop -t Task1 -t Task2

# Stop all sessions
llm-burst stop --all
```

## Provider Selectors

Each provider uses exact selectors from Stage 0 KM macros:

| Provider | Selector | Submit Method |
|----------|----------|---------------|
| Gemini | `textarea[aria-label='Enter your prompt']` | Enter key |
| Claude | `textarea[data-testid='composerTextarea']` | Enter key |
| ChatGPT | `textarea[data-id='root']` | Cmd+Enter |
| Grok | `textarea[placeholder='Ask Grok anything...']` | Enter key |

## Testing Coverage
All tests passing with comprehensive coverage:
- ✅ CLI help and version
- ✅ List command (empty, populated, JSON)
- ✅ Open command (args, dialog, stdin)
- ✅ Stop command (single, multiple, all)
- ✅ Error handling
- ✅ Provider registration

## Usage Examples

### Basic Workflow
```bash
# Open a new window with prompt
llm-burst open -p claude -t "Research-Task" -m "Explain quantum computing"

# List active sessions
llm-burst list

# Send follow-up prompt to existing session
llm-burst open -t "Research-Task" -m "What are the practical applications?"

# Stop the session
llm-burst stop -t "Research-Task"
```

### Interactive Mode
```bash
# Let swiftDialog prompt for all values
llm-burst open

# Pipe from other commands
echo "Analyze this log file" | llm-burst open -p gemini -t "Log-Analysis" --stdin
```

### Batch Operations
```bash
# Open multiple providers
for provider in gemini claude chatgpt; do
  llm-burst open -p $provider -t "Compare-$provider" -m "What is AGI?"
done

# Stop all sessions
llm-burst stop --all
```

## Architecture Decisions

### Why Click over argparse?
- Declarative command structure
- Built-in help generation
- Subcommand support
- Testing utilities

### Provider Registry Pattern
- Easy to add new providers
- Decoupled from browser layer
- Self-registering modules

### Sync/Async Bridge
- Click commands remain synchronous
- asyncio.run() for browser operations
- Clean separation of concerns

## Next Steps
Stage 3 provides the CLI foundation for:
- **Stage 4**: Auto-naming with Gemini API
- **Stage 5**: Chrome tab grouping
- **Stage 6**: Rectangle.app window positioning

## Files Modified/Created
- Created: `llm_burst/cli_click.py` (189 lines)
- Created: `llm_burst/providers/__init__.py` (54 lines)
- Created: `llm_burst/providers/gemini.py` (30 lines)
- Created: `llm_burst/providers/claude.py` (22 lines)
- Created: `llm_burst/providers/chatgpt.py` (22 lines)
- Created: `llm_burst/providers/grok.py` (20 lines)
- Created: `llm_burst/__main__.py` (4 lines)
- Modified: `llm_burst/browser.py` (added close_window)
- Modified: `llm_burst/cli.py` (added sync bridges)
- Created: `tests/test_cli_click.py` (145 lines)

## Integration Points
- **Stage 1**: Uses prompt_user() for GUI fallback
- **Stage 2**: Leverages BrowserAdapter and StateManager
- **Future**: Provides CLI surface for Stages 4-6

---
*Stage 3 completed successfully with full CLI functionality and all tests passing.*