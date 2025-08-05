#!/usr/bin/env bash
#
# bin/swift_chrome_fix.sh
# -----------------------
# Display a swiftDialog prompt that explains why Chrome needs to be restarted
# with remote debugging and asks the user for confirmation.
#
# Exit status:
#   0 → User chose "Relaunch"
#   1 → User chose "Cancel" (or closed dialog) / error
#
# The script gracefully degrades when swiftDialog is not available; callers
# should check the exit code only.
#
# -----------------------------------------------------------------------------
set -euo pipefail

DIALOG_BIN=$(command -v dialog || true)
if [[ -z "$DIALOG_BIN" ]]; then
  echo "swiftDialog CLI 'dialog' not found in PATH." >&2
  exit 1
fi

set +e  # Capture non-zero exit codes
"$DIALOG_BIN" \
  --json \
  --title "Enable Chrome Remote Debugging" \
  --width 520 --height 220 \
  --messagefont "size=13" \
  --message "llm-burst must restart Google Chrome with remote debugging enabled on port 9222.\n\nAny **Incognito** windows will be closed.\n\nRelaunch Chrome now?" \
  --button1text "Relaunch" --button1action "return" \
  --button2text "Cancel"   \
  --moveable \
  --hidetimerbar
CODE=$?
set -e

# Normalise: 0 = relaunch, 1 = cancel/other
if [[ $CODE -eq 0 ]]; then
  exit 0
else
  exit 1
fi