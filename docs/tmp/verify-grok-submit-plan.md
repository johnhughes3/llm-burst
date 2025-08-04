# Ultrathink: Grok Submission Verification Plan

## Executive Summary
This plan outlines a comprehensive approach to verify and fix the Grok submission flow in the llm-burst tool. The primary goal is to ensure that the JavaScript selectors used to automate Grok interactions are current and functional.

## Current State Analysis

### Architecture Overview
- **Core Technology**: Playwright-based browser automation with injected JavaScript
- **Provider Structure**: Each LLM provider has dedicated JS in `llm_burst/sites/<provider>.py`
- **Injection Mechanism**: JavaScript loaded via `get_injector()` from `llm_burst.providers`
- **Entry Point**: `automateGrokChat(promptText, researchMode, incognitoMode)`

### Grok-Specific Implementation
- **Primary Selectors**:
  - Textarea: `textarea[aria-label="Ask Grok anything"]`
  - Submit button: `button[type="submit"]`
- **Special Features**:
  - DeeperSearch/Research mode support
  - Incognito/Private Chat mode
  - Extensive fallback selectors
- **Helper Functions**:
  - `wait()` and `waitUntil()` for async operations
  - `simulateButtonClick()` for natural interactions
  - `simulateFocusSequence()` for input focusing

### Testing Infrastructure
- **Framework**: pytest with pytest-asyncio
- **Browser Control**: BrowserAdapter class for Chrome CDP management
- **Test Pattern**: Integration tests with real browser for submission verification
- **Screenshot**: Visual verification at `tests/assets/screenshots/`

## Implementation Strategy

### Phase 1: Test Infrastructure Setup
1. Create `tests/test_submission_grok.py`
2. Import required modules:
   - `pytest`, `asyncio`, `pathlib`
   - `playwright.async_api`
   - `llm_burst.browser.BrowserAdapter`
   - `llm_burst.providers.get_injector, InjectOptions`
   - `llm_burst.constants.LLMProvider`

### Phase 2: Test Implementation
```python
@pytest.mark.asyncio
async def test_grok_submission_flow():
    """Integration test for Grok prompt submission."""
    # 1. Launch browser via BrowserAdapter
    # 2. Navigate to Grok website
    # 3. Wait for page load
    # 4. Get injector for Grok
    # 5. Inject submission JS
    # 6. Submit "Hello, world!" prompt
    # 7. Wait for response initiation
    # 8. Take screenshot
    # 9. Assert submission succeeded
```

### Phase 3: Selector Verification Process
1. **Initial Check**: Run test with existing selectors
2. **Failure Analysis**: If selectors fail:
   - Launch browser manually
   - Inspect Grok UI with DevTools
   - Identify new stable selectors
3. **Update Strategy**:
   - Prefer semantic selectors (aria-label, role)
   - Add multiple fallback options
   - Document selector changes

### Phase 4: JavaScript Updates (if needed)
If selectors are stale:
1. **Textarea Updates**:
   - Primary: aria-label attribute
   - Fallback: placeholder text matching
   - Last resort: form textarea
2. **Submit Button Updates**:
   - Primary: type="submit"
   - Fallback: aria-label
   - Icon-based: SVG path matching
3. **Mode Controls**:
   - DeeperSearch dropdown
   - Think button
   - Incognito toggle

## Technical Implementation Details

### Browser Management
```python
async with BrowserAdapter() as adapter:
    # Open Grok window
    handle = await adapter.open_window("test-grok", LLMProvider.GROK)
    page = handle.page
    
    # Ensure page is loaded
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(2000)  # Extra stability wait
```

### JavaScript Injection
```python
# Get injector and inject JS
injector = get_injector(LLMProvider.GROK)
opts = InjectOptions(follow_up=False, research=False, incognito=False)

# Inject and execute
await injector(page, "Hello, world!", opts)
```

### Response Verification
```python
# Wait for response to start
await page.wait_for_selector(
    'text=/generating|thinking|typing/i',
    timeout=10000
)

# Or wait for message container changes
await page.wait_for_function(
    "document.querySelectorAll('.message-item').length > initialCount"
)
```

### Screenshot Capture
```python
screenshot_dir = Path("tests/assets/screenshots")
screenshot_dir.mkdir(parents=True, exist_ok=True)

screenshot_path = screenshot_dir / "grok_submission_latest.png"
await page.screenshot(path=str(screenshot_path), full_page=False)
```

## Risk Mitigation

### Authentication Challenges
- **Issue**: Grok may require login
- **Solution**: 
  - Use existing Chrome profile with saved credentials
  - Document authentication requirement
  - Add skip marker if auth unavailable

### Dynamic UI Elements
- **Issue**: Elements may load asynchronously
- **Solution**:
  - Use generous wait times
  - Implement retry logic
  - Multiple selector strategies

### Rate Limiting
- **Issue**: Too many requests may trigger limits
- **Solution**:
  - Keep prompts simple
  - Add delays between actions
  - Run tests sparingly

## Quality Assurance

### Coverage Requirements
- Target: 90-100% code coverage
- Focus areas:
  - Main submission path
  - Error handling
  - Selector fallbacks

### Linting & Type Checking
```bash
# Format code
ruff format tests/test_submission_grok.py

# Lint
ruff check tests/test_submission_grok.py --fix

# Type check
uv run mypy tests/test_submission_grok.py
```

### Test Execution
```bash
# Run specific test
pytest tests/test_submission_grok.py -v

# With coverage
pytest tests/test_submission_grok.py --cov=llm_burst.sites.grok --cov=llm_burst.providers

# Full test suite
pytest
```

## Success Criteria

1. ✅ Test file created at `tests/test_submission_grok.py`
2. ✅ Test successfully submits prompt to Grok
3. ✅ Screenshot generated showing submission
4. ✅ Any necessary selector updates applied
5. ✅ All existing tests continue passing
6. ✅ Coverage ≥ 90%
7. ✅ Code passes ruff, black, mypy
8. ✅ PR created with "Claude" label

## Rollback Plan

If updates break existing functionality:
1. Revert changes to `llm_burst/sites/grok.py`
2. Document failing selectors
3. Create issue for manual investigation
4. Mark test as xfail with explanation

## Timeline

1. **Hour 1**: Test creation and initial run
2. **Hour 2**: Selector debugging and updates (if needed)
3. **Hour 3**: Polish, coverage, and quality checks
4. **Hour 4**: PR creation and documentation

## Conclusion

This plan provides a systematic approach to verifying and updating the Grok submission flow. By creating a comprehensive integration test, we ensure that the JavaScript selectors remain functional and can quickly identify when UI changes require updates. The test will serve as both a verification tool and a regression guard for future changes.