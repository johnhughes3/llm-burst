# Stage 6 Completion - Window Arrangement via CDP

## Overview

Stage 6 implements automatic window arrangement using Chrome DevTools Protocol (CDP), enabling the `llm-burst arrange` command to position ungrouped Chrome windows into a predictable 2/3/4-pane grid without any external window manager.

## Completed: 2025-08-03

### Implementation Summary

Added a CDP-based arrangement helper to position LLM browser windows by setting window bounds directly.

### Key Components

#### 1. **Layout Management** (`layout.py`)
- `arrange()` function delegating to CDP arrangement helper
- Deterministic ordering by window ID inside the helper
- Respects max_windows parameter (default 4)

#### 2. **CLI Integration** (`cli_click.py`)
- New `arrange` command with `--max-windows` option
- Error handling and user feedback

### Technical Decisions

1. **CDP-Only**: Avoids external window managers and macOS permissions
2. **Grouped Sessions Exclusion**: Only arranges ungrouped windows to preserve tab group metaphor
3. **Deterministic Ordering**: Sorts by window_id to ensure consistent positioning

### Layout Configurations

| Windows | Layout Pattern |
|---------|---------------|
| 1 | Left half |
| 2 | Left half, Right half |
| 3 | Left half, Upper right, Lower right |
| 4 | Four quadrants (UL, UR, LL, LR) |

### Testing

Created test coverage (`test_arrange.py`) covering:
- CDP helper invocation
- Max windows parameter
- Error handling
- CLI command integration

All 8 tests passing ✓

### Usage Examples

```bash
# Arrange all ungrouped windows (up to 4)
llm-burst arrange

# Arrange only first 2 windows
llm-burst arrange --max-windows 2

# Arrange up to 6 windows (if layout defined)
llm-burst arrange -m 6
```

### Files Modified/Created

- **Modified**:
  - `llm_burst/cli_click.py` - Added arrange command
  - `tests/test_arrange.py` - Updated for CDP arrangement
  - `llm_burst/layout.py` - CDP-only window arrangement logic

### Dependencies

No new dependencies required.

### Edge Cases Handled

1. **No Sessions**: Silent no-op
2. **All Grouped**: Silent no-op
3. **Non-macOS Platforms**: Uses default screen geometry fallback

### Integration Points

- Works seamlessly with Stage 5's tab grouping
- Respects StateManager's session tracking
- Compatible with existing CLI structure

### Next Steps

Stage 6 completes the core window management functionality. The system now supports:
- Opening LLM windows (Stage 2-3)
- Auto-naming sessions (Stage 4)
- Tab grouping/ungrouping (Stage 5)
- Window arrangement (Stage 6)

Potential future enhancements:
- Support for more than 4 windows with extended layouts
- Integration with other window managers (yabai, Amethyst)
- User-customizable layout patterns
- Window position persistence/restoration

## Verification

Run the following to verify Stage 6 functionality:

```bash
# Run tests
uv run pytest tests/test_arrange.py -v

# Test CLI command
uv run llm-burst arrange --help

# Manual test (requires Chrome windows)
uv run llm-burst open "Test 1" --provider claude
uv run llm-burst open "Test 2" --provider gemini
uv run llm-burst arrange
```

All components tested and working as designed.
