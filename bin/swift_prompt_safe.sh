#!/usr/bin/env bash
#
# bin/swift_prompt_safe.sh
# ------------------------
# Safe wrapper for swiftDialog that handles the -50 error gracefully.
# Falls back to using clipboard content if swiftDialog fails.
#
# Exit status:
#   0 → User pressed "OK" or fallback succeeded (JSON printed to stdout)
#   1 → User pressed "Cancel" / closed dialog / any non-OK swiftDialog exit
#   2 → Script error (missing dependencies, etc.)
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

# ---------- honour env toggle -------------------------------------------------

# When LLM_BURST_NO_DIALOG is set (1/true/yes), skip swiftDialog entirely and
# return clipboard-based JSON so the Python CLI can proceed non-interactively.
NO_DIALOG=${LLM_BURST_NO_DIALOG:-}
if [[ "$NO_DIALOG" == "1" || "$NO_DIALOG" == "true" || "$NO_DIALOG" == "TRUE" || "$NO_DIALOG" == "yes" || "$NO_DIALOG" == "YES" ]]; then
  PROMPT_TEXT=$(clipboard_contents)
  cat <<EOF
{
  "Prompt Text": $(printf '%s' "$PROMPT_TEXT" | jq -Rs .),
  "Research mode": false,
  "Incognito mode": false
}
EOF
  exit 0
fi

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

# ---------- Normal swiftDialog operation -------------------------------------

# Create temp file for complex prompt text
TEMP_CONFIG=$(mktemp)
cat > "$TEMP_CONFIG" <<EOF
{
  "title": "Start LLM Burst",
  "width": 600,
  "height": 420,
  "message": "Please confirm your prompt from clipboard:\n\n**Keyboard shortcuts:** Press ⌘↩ (Cmd+Return) to submit",
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

set +e
RESPONSE=$("$DIALOG_BIN" --jsonfile "$TEMP_CONFIG" --json 2>/dev/null)
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
