# Stage 6 Completion - Window Positioning with Rectangle.app

## Overview

Stage 6 implements automatic window tiling via Rectangle.app, enabling the `llm-burst arrange` command to position ungrouped Chrome windows into a predictable 2/3/4-pane grid.

## Completed: 2025-08-03

### Implementation Summary

Added comprehensive Rectangle.app integration to automatically arrange LLM browser windows using native macOS window management.

### Key Components

#### 1. **Rectangle Action System** (`constants.py`)
- `RectangleAction` enum defining window positioning actions
- `RECTANGLE_LAYOUTS` mapping window counts to layout configurations
- `RECTANGLE_KEY_BINDINGS` for keyboard shortcut definitions

#### 2. **Rectangle Interface** (`rectangle.py`)
- Dual-mode execution: prefers `rectangle-cli` if available
- AppleScript fallback for keyboard shortcut simulation
- Platform-specific safety checks (macOS only)

#### 3. **Layout Management** (`layout.py`)
- `arrange()` function to tile ungrouped windows
- Window focusing via AppleScript
- Deterministic ordering by window ID
- Respects max_windows parameter (default 4)

#### 4. **CLI Integration** (`cli_click.py`)
- New `arrange` command with `--max-windows` option
- Error handling and user feedback

### Technical Decisions

1. **Rectangle CLI Priority**: Checks for `rectangle-cli` first for speed and reliability
2. **Keyboard Fallback**: Uses AppleScript to simulate Rectangle shortcuts when CLI unavailable
3. **Grouped Sessions Exclusion**: Only arranges ungrouped windows to preserve tab group metaphor
4. **Deterministic Ordering**: Sorts by window_id to ensure consistent positioning

### Layout Configurations

| Windows | Layout Pattern |
|---------|---------------|
| 1 | Left half |
| 2 | Left half, Right half |
| 3 | Left half, Upper right, Lower right |
| 4 | Four quadrants (UL, UR, LL, LR) |

### Testing

Created comprehensive test suite (`test_arrange.py`) covering:
- Empty session handling
- 2, 3, and 4-window arrangements
- Grouped session exclusion
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
  - `llm_burst/constants.py` - Added Rectangle enums and mappings
  - `llm_burst/cli_click.py` - Added arrange command
  - `tests/test_arrange.py` - Replaced with Stage 6 tests

- **Created**:
  - `llm_burst/rectangle.py` - Rectangle.app interface layer
  - `llm_burst/layout.py` - Window arrangement logic

### Dependencies

No new dependencies required. Rectangle.app must be installed on the user's system, but the implementation gracefully handles its absence with error messages.

### Edge Cases Handled

1. **No Rectangle.app**: Returns clear error message
2. **No Sessions**: Silent no-op
3. **All Grouped**: Silent no-op
4. **Custom Key Bindings**: Future support via environment variables
5. **Non-macOS Platforms**: Raises RuntimeError with platform message

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

# Manual test (requires Chrome windows and Rectangle.app)
uv run llm-burst open "Test 1" --provider claude
uv run llm-burst open "Test 2" --provider gemini
uv run llm-burst arrange
```

All components tested and working as designed.