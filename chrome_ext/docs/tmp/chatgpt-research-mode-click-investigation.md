# ChatGPT Research Mode Click Investigation

## Problem Statement

We need to programmatically activate ChatGPT's "Deep Research" mode from a Chrome extension. This requires clicking two specific buttons:

1. **Plus Button** (`[data-testid="composer-plus-btn"]`) - Opens the feature menu
2. **Deep Research Option** (`[role="menuitemradio"]` with text "Deep research") - Activates research mode

## Current Findings

### What Works ✅

**Playwright MCP (Chrome DevTools Protocol)**
- Successfully clicks both buttons and activates research mode
- Uses Chrome DevTools Protocol (CDP) to send real browser-level events
- React accepts these as trusted user interactions
- Exact steps that work:
  ```javascript
  // Step 1: Click plus button
  await page.getByTestId('composer-plus-btn').click();

  // Step 2: Click Deep research option
  await page.getByRole('menuitemradio', { name: 'Deep research' }).click();
  ```

### What Doesn't Work ❌

**1. Direct JavaScript in Console**
```javascript
// Simple click - FAILS
document.querySelector('[data-testid="composer-plus-btn"]').click();
```

**2. Simulated Mouse Events**
```javascript
// Full mouse event simulation - FAILS
function simulateMouseClick(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventInit = {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    // ... other properties
  };

  element.dispatchEvent(new MouseEvent('mousedown', eventInit));
  element.dispatchEvent(new MouseEvent('mouseup', eventInit));
  element.dispatchEvent(new MouseEvent('click', eventInit));
}
```

**3. Direct React Handler Calls**
```javascript
// Attempting to call React's onClick directly - FAILS
function triggerReactClick(element) {
  const reactKey = Object.keys(element).find(key =>
    key.startsWith('__reactFiber') || key.startsWith('__reactProps')
  );
  const fiber = element[reactKey];
  if (fiber?.memoizedProps?.onClick) {
    fiber.memoizedProps.onClick(syntheticEvent);
  }
}
```

**4. JavaScript via Playwright's evaluate()**
```javascript
// Even JS executed through Playwright's evaluate context - FAILS
await page.evaluate(() => {
  document.querySelector('[data-testid="composer-plus-btn"]').click();
});
```

## Root Cause Analysis

React's event system distinguishes between:

1. **Trusted Events** (`isTrusted: true`)
   - Created by real user interactions
   - Created by Chrome DevTools Protocol
   - React processes these normally

2. **Untrusted Events** (`isTrusted: false`)
   - Created by JavaScript code
   - Synthetic events from extensions
   - React may ignore or handle differently

The ChatGPT interface specifically checks for trusted events before opening the menu, likely as a security measure to prevent automation.

## The Challenge

Our Chrome extension needs to simulate clicks that React will accept as trusted. The paradox:

- **Playwright MCP works** because it uses CDP through its extension bridge
- **Our extension can't** use the same approach with regular JavaScript
- Regular Chrome extensions don't have access to CDP-level click simulation

## Potential Workarounds Needed

We need to explore alternative approaches:

1. **Chrome Debugger API** - Requires special permissions but might allow CDP access
2. **Keyboard Navigation** - Use keyboard shortcuts instead of clicks
3. **Direct URL Manipulation** - If research mode has a URL parameter
4. **Message Passing** - Communicate with the page in a different way
5. **Mutation Observer** - Wait for UI changes and interact differently
6. **Alternative UI Paths** - Find other ways to activate research mode

## Visual Confirmation of Success

When research mode is successfully activated:
- Heading changes from "What are you working on?" to **"What are you researching?"**
- **Research tag** appears with an X button to remove it
- **GitHub Sources** button becomes visible
- Placeholder text changes to "Get a detailed report"

## Next Steps

Investigate workarounds that don't rely on simulating trusted clicks, or find a way for the extension to generate events that React will accept as legitimate user interactions.