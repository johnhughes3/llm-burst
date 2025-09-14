# Keyboard Accessibility Plan for LLM Burst Helper (Chrome Extension)

Date: 2025-09-13

Owner: @johnhughes

Scope: `chrome_ext/` (Manifest V3)

## Objectives

- Open the extension popup with a keyboard shortcut (already supported via `_execute_action`).
- Add dedicated shortcuts to: (a) open popup with Research toggled on, (b) open popup with Incognito toggled on, (c) open a standalone Launcher window.
- Make the popup fast to use entirely from the keyboard: focus prompt on open, Enter to send (optional), Shift+Enter for newline, Alt+R/Alt+I to toggle Research/Incognito, Esc to close.
- Ensure MV3‑safe state handoff from background command → popup (no direct params). Use `chrome.storage.session`.

## User Stories

1. As a user, I press a global shortcut and the LLM Burst popup opens focused on the prompt.
2. As a user, I press another shortcut to open the popup with Research pre‑enabled so I can just paste and hit Enter.
3. As a user, I prefer Enter to send; I can enable this in Options. Once enabled, Enter sends and Shift+Enter inserts a newline.
4. As a user in the popup, I can quickly toggle Research/Incognito with Alt+R / Alt+I and close with Esc.
5. As a power user, I can open a full Launcher window via a shortcut.

## Design Decisions

- Shortcuts are defined in `manifest.json` under `commands`. Users can remap at `chrome://extensions/shortcuts`.
- Programmatic popup open uses `chrome.action.openPopup()` (MV3). Passing flags is done through `chrome.storage.session.set({ pendingPopupOptions: {...} })` before calling `openPopup()`.
- Popup reads and clears `pendingPopupOptions` on init to apply and avoid carryover.
- “Enter to send” is opt‑in (default off) to avoid surprising multiline users. Config lives in `chrome.storage.sync.settings.sendOnEnter`.
- Key handling is guarded by IME composition checks and respects standard textareas: Shift+Enter always newline.

## Changes

1) `manifest.json`
- Keep existing `_execute_action` (open popup) shortcut (now Cmd/Ctrl+Shift+U by default to avoid common conflicts).
- Add three new commands with suggested keys (users can override):
  - `open_launcher` → no default (open `launcher.html` in a small window)

2) `background.js`
- Add `chrome.commands.onCommand` handler:
  - Only `open_launcher` remains (no default). `chrome.windows.create({ url: runtime.getURL('launcher.html'), type: 'popup', width: 420, height: 640 })`.

3) `popup.js`
- Load settings: add `sendOnEnter` from `chrome.storage.sync.settings`.
- Read and clear `chrome.storage.session.pendingPopupOptions` on init; apply to Research/Incognito toggles.
- Keybindings:
  - In textarea: if `sendOnEnter` and Enter without modifiers → send; Shift+Enter → newline; Cmd/Ctrl+Enter still sends.
  - Document: Cmd/Ctrl+Shift+R toggles Research; Cmd/Ctrl+Shift+I toggles Incognito; Esc closes popup (`window.close()`).
  - Update the visible hint from “⌘+Enter to send” → “Enter to send” when `sendOnEnter` is enabled.

4) `options.html` / `options.js`
- Add a “Send on Enter (Shift+Enter for newline)” checkbox under Defaults. Persist to `settings.sendOnEnter`.
- Optional helper text pointing to `chrome://extensions/shortcuts` to configure global commands.

5) `README.md`
- Brief section listing available commands and how to configure shortcuts.

## Risks & Mitigations

- Clipboard prefill on popup open may still fail without a trusted gesture; current code already handles errors gracefully.
- Some default shortcut combos may be reserved by Chrome/OS. Users can remap in `chrome://extensions/shortcuts`.
- Programmatic popup open is supported in MV3 via `chrome.action.openPopup()`; if unavailable in a particular channel, the fallback is to open `launcher.html` window instead.

## Test Plan (manual)

- Reload extension in Chrome; open `chrome://extensions/shortcuts` and verify new commands exist.
- Trigger `_execute_action` (Cmd/Ctrl+Shift+U) → popup opens focused on prompt.
- Open popup, then use in‑popup keys:
  - Cmd/Ctrl+Shift+R → Research toggle
  - Cmd/Ctrl+Shift+I → Incognito toggle
- In Options, enable “Send on Enter”, then in popup press Enter to send and Shift+Enter to create newline.
- Alt+R / Alt+I toggle; Esc closes popup.
- Launcher shortcut opens a small window with launcher UI.

## Rollback

- Revert `manifest.json`, `background.js`, `popup.js`, `options.*`, and README changes.
