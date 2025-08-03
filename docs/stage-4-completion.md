# Stage 4: Auto-naming with Gemini API - COMPLETED ✅

## Summary
Stage 4 successfully implemented intelligent task naming using the Gemini API. When no explicit task name is provided, the system generates a placeholder name, then uses Gemini to analyze the conversation context and create a meaningful, descriptive task name automatically.

## Components Delivered

### 1. Auto-naming Module (`llm_burst/auto_namer.py`)
- **Gemini API integration**: Uses `google-generativeai` library with structured output
- **Conversation extraction**: Provider-specific selectors to extract chat content
- **Task name generation**: Sends context to Gemini with JSON schema for structured response
- **Window title update**: Updates browser tab title to match renamed task
- **Placeholder detection**: Identifies auto-generated names (PROVIDER-xxxx pattern)

### 2. State Manager Enhancement (`llm_burst/state.py`)
- **rename() method**: Atomic rename operation with collision detection
- **Persistent state updates**: Automatically saves renamed sessions to disk
- **Session integrity**: Prevents duplicate names and handles edge cases

### 3. CLI Integration (`llm_burst/cli.py`, `llm_burst/cli_click.py`)
- **Optional task names**: Users can omit `-t/--task-name` for auto-naming
- **Placeholder generation**: Creates temporary names like "GEMINI-1a2b"
- **Auto-name trigger**: Invokes naming after window opens and prompt is sent
- **User feedback**: Shows "Session renamed to 'X'" when successful

### 4. Browser Adapter (`llm_burst/browser.py`)
- **set_window_title()**: Updates document.title via page.evaluate()
- **Error handling**: Gracefully handles CSP restrictions

## Key Features

### Automatic Naming Flow
1. User runs `llm-burst open -p gemini` (no task name)
2. System generates placeholder "GEMINI-xxxx"
3. Window opens and prompt is sent (if provided)
4. Auto-namer extracts conversation from page
5. Gemini API generates descriptive name
6. State is renamed and window title updated
7. User sees: "Session renamed to 'Quantum Computing Research'"

### Conversation Extraction
Provider-specific selectors ensure accurate content extraction:

| Provider | User Selector | Assistant Selector |
|----------|--------------|-------------------|
| Gemini | `div[data-message-author='user'] .message-content` | `div[data-message-author='assistant'] .message-content` |
| Claude | `div[data-testid='user-message']` | `div[data-testid='assistant-message']` |
| ChatGPT | `div[data-message-author-role='user']` | `div[data-message-author-role='assistant']` |
| Grok | `div.chat-message.user` | `div.chat-message.assistant` |

### Gemini Configuration
- **Model**: `gemini-1.5-flash` (fast, efficient)
- **Structured output**: Pydantic schema ensures valid JSON response
- **Context limit**: 4000 characters (most recent conversation)
- **Timeout**: 15 seconds for entire operation
- **API key**: Via `GEMINI_API_KEY` environment variable

## Testing Coverage
Comprehensive test suite with 7 new tests:
- ✅ Placeholder name generation
- ✅ Placeholder name detection
- ✅ StateManager rename functionality
- ✅ Conversation extraction from page
- ✅ Gemini API task name generation
- ✅ Full auto-naming flow
- ✅ CLI integration with auto-naming

All existing tests updated and passing (18 total tests).

## Usage Examples

### Basic Auto-naming
```bash
# No task name provided - triggers auto-naming
llm-burst open -p claude -m "Explain quantum entanglement"
# Output: Opened window 'CLAUDE-3a4f' → CLAUDE
#         Prompt sent.
#         Session renamed to 'Quantum Entanglement Explanation'
```

### Manual Override
```bash
# Explicit task name - no auto-naming
llm-burst open -p gemini -t "My Research" -m "Tell me about AI"
# Output: Opened window 'My Research' → GEMINI
```

### With Dialog Fallback
```bash
# No arguments - swiftDialog prompts, then auto-names if no task provided
llm-burst open
# Dialog appears, user provides only provider and prompt
# Auto-naming activates after window opens
```

## Architecture Decisions

### Why Gemini API?
- Structured output support with JSON schemas
- Fast response times with Flash model
- Cost-effective for short naming tasks
- Reliable and consistent results

### Placeholder Pattern
- Format: `PROVIDER-xxxx` (4 hex characters)
- Easy to detect for auto-naming eligibility
- Unique enough to avoid collisions
- User-friendly temporary identifier

### Async/Sync Bridge
- Auto-naming runs synchronously from CLI
- Uses `asyncio.run()` to execute async operations
- Maintains clean separation between sync CLI and async browser

## Error Handling
- **Missing API key**: Logs warning, skips auto-naming
- **Gemini API errors**: Logged, placeholder name retained
- **Extraction failures**: Gracefully degraded, no rename
- **Name collisions**: Logged warning, keeps original
- **Timeout**: 15-second limit prevents hanging

## Configuration
Set the Gemini API key:
```bash
export GEMINI_API_KEY="your-api-key-here"
```

Optional environment variables:
- `GEMINI_API_KEY`: API key for Gemini (required for auto-naming)

## Dependencies Added
- `google-generativeai>=0.8.0`: Gemini API client
- `pydantic>=2.5.0`: Structured output validation
- `rich>=13.5.0`: Enhanced terminal output (already used)

## Next Steps
Stage 4 provides the foundation for:
- **Stage 5**: Chrome tab grouping for organization
- **Stage 6**: Rectangle.app window positioning

## Files Modified/Created
- Created: `llm_burst/auto_namer.py` (218 lines)
- Modified: `llm_burst/state.py` (added rename method)
- Modified: `llm_burst/cli.py` (placeholder generation, auto_name_sync)
- Modified: `llm_burst/cli_click.py` (optional task names, auto-naming trigger)
- Modified: `llm_burst/browser.py` (set_window_title function)
- Modified: `llm_burst/constants.py` (Gemini configuration)
- Modified: `pyproject.toml` (new dependencies)
- Created: `tests/test_auto_namer.py` (213 lines)
- Modified: `tests/test_cli_click.py` (fixed mock objects)

## Integration Points
- **Stage 1**: SwiftDialog still provides fallback for missing values
- **Stage 2**: Browser adapter provides page object for extraction
- **Stage 3**: Click CLI orchestrates the naming flow
- **Future**: Tab grouping can use generated names for organization

---
*Stage 4 completed successfully with intelligent auto-naming via Gemini API and full test coverage.*