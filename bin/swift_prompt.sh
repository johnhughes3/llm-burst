#!/usr/bin/env bash
#
# bin/swift_prompt.sh
# -------------------
# Display a swiftDialog prompt that mirrors the original Keyboard Maestro dialog
# used by the llm-burst workflow.
#
# Exit status:
#   0 → User pressed "OK"  (JSON printed to stdout)
#   1 → User pressed "Cancel" / closed dialog / any non-OK swiftDialog exit
#   2 → Script error (missing dependencies, etc.)
#
# Requirements:
#   • macOS
#   • swiftDialog installed and its CLI binary "dialog" available in PATH
#
# -----------------------------------------------------------------------------
set -euo pipefail

# ---------- helper functions --------------------------------------------------

# Return clipboard contents or an empty string if pbpaste is unavailable.
clipboard_contents() {
  if command -v pbpaste >/dev/null 2>&1; then
    pbpaste
  else
    echo ""
  fi
}

# ---------- dependency check --------------------------------------------------

DIALOG_BIN=$(command -v dialog || true)
if [[ -z "$DIALOG_BIN" ]]; then
  echo "swiftDialog (binary 'dialog') not found in PATH. Install via 'brew install swiftDialog'." >&2
  exit 2
fi

# ---------- build prompt ------------------------------------------------------

if [[ -n "${LLMB_DEFAULT_PROMPT:-}" ]]; then
  PROMPT_TEXT="$LLMB_DEFAULT_PROMPT"
else
  PROMPT_TEXT=$(clipboard_contents)
fi

# Invoke swiftDialog.
#   --json   → print JSON to stdout
#   --checkbox → checkboxes
#   --textfield → input fields
set +e  # allow capture of non-zero exit codes
# Need to escape the prompt text for shell
ESCAPED_PROMPT=$(printf '%s' "$PROMPT_TEXT" | sed "s/'/'\\\\''/g")

# Create temp file for complex prompt text
TEMP_CONFIG=$(mktemp)
cat > "$TEMP_CONFIG" <<EOF
{
  "title": "Start LLM Burst",
  "width": 600,
  "height": 420,
  "message": "Please confirm your prompt from clipboard:",
  "messagefont": "size=14",
  "textfield": [
    {
      "title": "Prompt Text",
      "editor": true,
      "required": true,
      "value": $(printf '%s' "$PROMPT_TEXT" | jq -Rs .)
    }
  ],
  "checkbox": [
    {"label": "Research mode", "checked": false},
    {"label": "Incognito mode", "checked": false}
  ],
  "button1text": "OK",
  "button1action": "return",
  "button2text": "Cancel",
  "hidetimerbar": true,
  "moveable": true
}
EOF

RESPONSE=$("$DIALOG_BIN" --jsonfile "$TEMP_CONFIG" --json)
DIALOG_EXIT=$?
rm -f "$TEMP_CONFIG"
set -e

# ---------- normalise exit status --------------------------------------------

if [[ $DIALOG_EXIT -eq 0 ]]; then
  # User pressed OK – swiftDialog already emitted JSON.
  echo "$RESPONSE"
  exit 0
else
  # Treat all other swiftDialog codes (3=Cancel, 4=Timeout, …) as "Cancel".
  exit 1
fi