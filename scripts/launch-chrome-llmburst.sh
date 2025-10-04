#!/bin/bash
set -euo pipefail

PORT="${1:-9222}"
PROFILE_DIR="$HOME/Library/Application Support/Google/Chrome-LLMBurst"
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -d "$PROFILE_DIR" ]; then
  mkdir -p "$PROFILE_DIR"
fi

if [ ! -x "$CHROME_APP" ]; then
  echo "Google Chrome not found at $CHROME_APP" >&2
  exit 1
fi

echo "Starting Chrome with remote debugging on port $PORT using profile: $PROFILE_DIR"
nohup "$CHROME_APP" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  "${@:2}" \
  >/tmp/llm-burst-chrome.log 2>&1 &

echo "Chrome launch request sent. Check /tmp/llm-burst-chrome.log for output."
