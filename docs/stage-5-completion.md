# Stage 5: Chrome Tab Grouping - COMPLETED ✅

## Summary
Stage 5 successfully implemented Chrome tab grouping functionality, allowing users to organize related LLM windows into visual groups with colors. The implementation uses Chrome DevTools Protocol (CDP) TabGroups API to create, manage, and assign tabs to groups, providing better organization for multiple concurrent AI sessions.

## Components Delivered

### 1. Tab Groups Data Structures
- **TabColor enum** (`constants.py`): Chrome's 8 supported colors (grey, blue, red, yellow, green, pink, purple, cyan)
- **TabGroup dataclass** (`state.py`): Stores group_id, name, and color
- **LiveSession enhancement**: Added optional group_id field for group association
- **Provider color mapping**: Default colors for automatic grouping by provider

### 2. State Management (`state.py`)
- **Version bump**: State file version 2 with backward compatibility
- **Groups persistence**: New "groups" array in state.json
- **Group operations**:
  - `register_group()`: Create/update group definitions
  - `get_group_by_name()`: Find groups by display name
  - `list_groups()`: Return all known groups
  - `assign_session_to_group()`: Attach sessions to groups

### 3. Browser Adapter Extensions (`browser.py`)
- **Tab groups detection**: `_probe_tab_groups()` checks CDP support
- **Group management**:
  - `_get_or_create_group()`: Creates new or returns existing group
  - `_add_target_to_group()`: Adds tab to Chrome group
  - `move_task_to_group()`: Public API for moving tasks
- **Graceful fallback**: RuntimeError when unsupported, allows core functionality to continue

### 4. Synchronous Wrappers (`tab_groups.py`)
- **create_group_sync()**: Create groups from CLI
- **move_to_group_sync()**: Move tasks to groups
- **list_groups_sync()**: List all groups
- Maintains synchronous CLI interface while using async CDP

### 5. CLI Integration (`cli_click.py`)
- **Open command enhancement**: `--group` option to assign on creation
- **New group commands**:
  - `llm-burst group list`: Display all tab groups
  - `llm-burst group create NAME [--color COLOR]`: Create new group
  - `llm-burst group move TASK GROUP`: Move existing task to group

## Key Features

### Command Examples
```bash
# Open window directly into a group
llm-burst open -p gemini -t "Research" --group "AI Projects"

# Create a new group
llm-burst group create "Development" --color blue

# List all groups
llm-burst group list
    ID  Name                  Colour
-----------------------------------
     1  AI Projects           green
     2  Development           blue

# Move existing task to group
llm-burst group move "Research" "AI Projects"
```

### CDP Commands Used
- **TabGroups.create**: Create new tab group with title and color
- **TabGroups.get**: Query group existence (used for support detection)
- **TabGroups.addTab**: Add target (tab) to group
- **Browser.getWindowForTarget**: Get window ID for group creation

### Default Provider Colors
| Provider | Default Color |
|----------|--------------|
| Gemini   | Blue         |
| Claude   | Yellow       |
| ChatGPT  | Green        |
| Grok     | Red          |

## Architecture Highlights

### Backward Compatibility
- State file version 2 maintains compatibility with version 1
- Sessions without groups (group_id=None) work normally
- Tab grouping features are optional - core functionality unaffected

### Error Handling
- **Unsupported browsers**: Detected via CDP probe, operations fail gracefully
- **Duplicate group names**: Returns existing group instead of creating duplicate
- **Missing tasks**: Warning logged when moving non-existent task
- **Color validation**: Falls back to grey for invalid colors

### State Persistence
```json
{
  "version": 2,
  "saved_at": "2024-01-20T10:30:00Z",
  "sessions": [
    {
      "task_name": "Research-AI",
      "provider": "GEMINI",
      "target_id": "ABC123",
      "window_id": 100,
      "group_id": 1
    }
  ],
  "groups": [
    {
      "group_id": 1,
      "name": "AI Projects",
      "color": "blue"
    }
  ]
}
```

## Testing Coverage
Comprehensive test suite with 11 tests:
- ✅ TabColor enum values
- ✅ Default provider colors
- ✅ TabGroup dataclass
- ✅ LiveSession with group_id
- ✅ StateManager group operations
- ✅ Browser tab groups detection
- ✅ Group creation via CDP
- ✅ Adding targets to groups
- ✅ Synchronous wrapper functions
- ✅ CLI open with --group
- ✅ CLI group commands

All tests passing (11/11).

## Implementation Decisions

### Why CDP TabGroups API?
- Native Chrome integration for best UX
- Visual organization with colors
- Persistent across page refreshes
- No additional dependencies

### Synchronous CLI Design
- Maintains consistent UX with existing commands
- `asyncio.run()` bridges to async CDP operations
- Simple for users, complex async hidden

### Group ID vs Name
- Internal: Uses numeric group_id from Chrome
- External: Users work with friendly names
- StateManager maps between them

## Limitations & Future Work

### Current Limitations
- Requires Chrome/Chromium with TabGroups support (v85+)
- Groups are per-window (not global across windows)
- No automatic grouping by task prefix yet
- Tab groups lost on Chrome restart (recreated from state)

### Potential Enhancements
- Automatic grouping based on task name patterns
- Group templates for common workflows
- Bulk operations (close group, prompt to group)
- Integration with Stage 6 window positioning

## Files Modified/Created
- Modified: `llm_burst/constants.py` (TabColor enum, provider colors)
- Modified: `llm_burst/state.py` (TabGroup class, group operations)
- Modified: `llm_burst/browser.py` (CDP integration, group management)
- Created: `llm_burst/tab_groups.py` (60 lines - sync wrappers)
- Modified: `llm_burst/cli_click.py` (group commands, --group option)
- Created: `tests/test_tab_groups.py` (273 lines - comprehensive tests)

## Integration Points
- **Stage 2**: Uses BrowserAdapter and CDP connection
- **Stage 3**: Extends CLI with group commands
- **Stage 4**: Auto-named tasks can be grouped automatically
- **Stage 6**: Groups provide context for window positioning

## Usage Workflow

### Typical Session
1. Create groups for different work contexts
2. Open LLM windows directly into appropriate groups
3. Move tasks between groups as focus shifts
4. Visual organization with colored tab groups
5. State persists across llm-burst invocations

### Example: Research Workflow
```bash
# Setup groups
llm-burst group create "Research" --color blue
llm-burst group create "Writing" --color green
llm-burst group create "Coding" --color yellow

# Open windows in groups
llm-burst open -p gemini --group Research
llm-burst open -p claude -t "Draft Article" --group Writing
llm-burst open -p chatgpt -t "Python Helper" --group Coding

# Reorganize as needed
llm-burst group move "Draft Article" "Research"
```

---
*Stage 5 completed successfully with full Chrome tab grouping functionality and comprehensive test coverage.*