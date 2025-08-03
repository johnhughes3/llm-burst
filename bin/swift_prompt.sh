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

# Default task name in ICU format: "Fri, Nov 15, 2024 3:45"
default_task_name() {
  # Note: BSD date (macOS) understands %-d and %-H for non-padded day and hour.
  date "+%a, %b %-d, %Y %-H:%M"
}

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

TASK_NAME=$(default_task_name)
PROMPT_TEXT=$(clipboard_contents)

# Invoke swiftDialog.
#   --json   → print JSON to stdout
#   --select → dropdowns
#   --textfield / --textarea → input fields
set +e  # allow capture of non-zero exit codes
RESPONSE=$("$DIALOG_BIN" \
  --json \
  --title "Start LLM Burst" \
  --width 600 --height 420 \
  --textfield "Task Name,required,default=$TASK_NAME" \
  --textarea "Prompt Text,default=$PROMPT_TEXT" \
  --select "Research mode,values=No|Yes,default=No" \
  --select "Incognito mode,values=No|Yes,default=No" \
)
DIALOG_EXIT=$?
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