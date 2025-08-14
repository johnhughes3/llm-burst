# Grok Text Submission Fix - Issue Summary

## Problem Statement
Grok.com text submission is flaky and causes issues when pasting/submitting prompts through the llm-burst tool. The current JavaScript automation logic fails intermittently, particularly with text input.

## Investigation Findings

### Current State (from Playwright exploration)
- **Input Element**: Standard `<textarea aria-label="Ask Grok anything">` (NOT contenteditable)
- **Submit Button**: Dynamic `<button aria-label="Submit">` appears after text entry
- **Working Methods**: Direct fill(), type(), and keyboard paste all work correctly
- **Issue**: Current code assumes contenteditable div and uses complex character-by-character insertion

### Root Causes
1. **UI Mismatch**: Code expects contenteditable but Grok uses standard textarea
2. **Over-complex Event Simulation**: Character-by-character typing for non-existent contenteditable
3. **Wrong Selector Priority**: Checks for contenteditable before textarea
4. **Complex Paste Logic**: Simulates full keyboard paste sequence unnecessarily
5. **Dynamic Submit**: Submit button timing issues

## Proposed Solution

### Approach
Simplify the Grok text input to use standard textarea methods while preserving incognito mode functionality.

### Implementation Steps
1. **Update selector priority**: Check for textarea first, contenteditable as fallback
2. **Simplify text input**: Use direct value assignment for textarea
3. **Fix submit button detection**: Ensure proper wait for dynamic button
4. **Remove unnecessary complexity**: Eliminate character-by-character typing for textarea
5. **Preserve working features**: Keep incognito mode logic intact

### Code Changes Required

#### File: `llm_burst/sites/grok.py`
- **Lines 350-351**: Reverse selector priority (textarea before contenteditable)
- **Lines 394-424**: Simplify contenteditable handling (make it fallback only)
- **Lines 433-493**: Simplify textarea input to direct value assignment
- **Lines 616-650**: Improve submit button detection with proper waits

### Alternative Approaches Considered
1. **Complete rewrite**: Too risky, would lose working incognito functionality
2. **Playwright-only**: Would require changing architecture
3. **Minimal patch**: Chosen approach - surgical fixes to specific issues

## Test Plan

### Unit Tests
- Test textarea detection with mock DOM
- Test simplified input method
- Test submit button wait logic

### Integration Tests
- Test full flow with real Grok.com
- Test with/without incognito mode
- Test rapid successive submissions
- Test with various prompt lengths

### Regression Tests
- Ensure incognito mode still works
- Ensure research mode still works
- Ensure other providers unaffected

## Acceptance Criteria
1. ✅ Text submission works reliably (>95% success rate)
2. ✅ No character-by-character typing for textarea
3. ✅ Submit button found consistently
4. ✅ Incognito mode preserved
5. ✅ No regression in other features

## Risks & Mitigations
- **Risk**: Grok UI may change again
  - **Mitigation**: Add UI change detection in tests
- **Risk**: Breaking incognito mode
  - **Mitigation**: Comprehensive testing of all modes
- **Risk**: Race conditions with dynamic submit
  - **Mitigation**: Proper wait strategies with timeouts

## Backout Plan
1. Revert commits if issues detected
2. Previous version remains in git history
3. Can selectively revert just grok.py changes

## Implementation Timeline
1. Get feedback from codex (5 min)
2. Implement changes (15 min)
3. Test locally (10 min)
4. Create PR with tests (10 min)
5. Merge after review

## Files Affected
- `/Users/johnhughes/Development/tools/llm-burst/llm_burst/sites/grok.py` - Main implementation
- `/Users/johnhughes/Development/tools/llm-burst/tests/test_submission_grok.py` - Update tests
- `/Users/johnhughes/Development/tools/llm-burst/tests/test_grok_js_injection.py` - Update injection tests