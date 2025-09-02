# LLM Burst Helper Chrome Extension

This extension enables tab grouping functionality for the llm-burst CLI tool.

## Installation

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select this `chrome_ext` folder
5. The extension should appear in your extensions list

## Important After Installation

**You must reload the extension after making any changes:**
1. Go to `chrome://extensions`
2. Find "LLM Burst Helper"
3. Click the refresh icon
4. Reload any open tabs that need to use the extension

## Testing the Extension

After installation, you can test if it's working:

1. Open Chrome DevTools on any page (F12)
2. Go to Console tab
3. Run this command:
```javascript
window.postMessage({ type: 'llmburst-ping' }, '*');
```

You should see a response in the console if the extension is working.

## Permissions

The extension needs permissions for:
- Tab and tab group management
- Content script injection on LLM sites and test sites
- Message passing between pages and the extension

## Troubleshooting

If the extension isn't working:

1. **Check it's enabled**: Go to chrome://extensions and ensure it's toggled on
2. **Check for errors**: Click "Details" on the extension and look for errors
3. **Reload the extension**: Click the refresh button on the extension card
4. **Check permissions**: Make sure the site you're testing is in the manifest
5. **Check console**: Open DevTools and look for any error messages

## Quick QA: Research & Incognito Toggles

Use this checklist to verify end-to-end behavior.

- ChatGPT Research
  - In the popup, enable Research and include ChatGPT as a provider.
  - Confirm ChatGPT shows the “Pro Research‑grade intelligence” model (or equivalent indicator).

- Gemini Research
  - Enable Research and include Gemini.
  - Confirm the Tools panel indicates “Deep Research” is active.

- Gemini Incognito (Temporary chat)
  - Enable Incognito and include Gemini.
  - Confirm the UI indicates “Temporary chat” mode after navigation.

- Claude Research
  - Enable Research and include Claude.
  - Confirm the Research button becomes active before submission.

If any steps fail, capture a screenshot and open an issue with the page URL and visible UI state.
