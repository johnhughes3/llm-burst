#!/bin/bash

# LLM Burst launcher for Keyboard Maestro and terminal use
# Optimized for reliability in limited PATH environments

set -e  # Exit on error
set -o pipefail

# Enable verbose bash tracing when LLM_BURST_KM_DEBUG=1
if [ "${LLM_BURST_KM_DEBUG:-}" = "1" ]; then
    set -x
fi

# Navigate to project directory
cd "$(dirname "$0")"

# Prefer project virtualenv if present; fallback to uv runner.
LLM_BURST_BIN=""
if [ -x ".venv/bin/llm-burst" ]; then
    LLM_BURST_BIN=".venv/bin/llm-burst"
else
    # Find uv - prioritize user installation, then check common locations
    if [ -x "/Users/johnhughes/.local/bin/uv" ]; then
        UV_BIN="/Users/johnhughes/.local/bin/uv"
    elif [ -x "/opt/homebrew/bin/uv" ]; then
        UV_BIN="/opt/homebrew/bin/uv"
    elif [ -x "/usr/local/bin/uv" ]; then
        UV_BIN="/usr/local/bin/uv"
    else
        # Last resort: add paths and try command
        export PATH="/Users/johnhughes/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
        if command -v uv &> /dev/null; then
            UV_BIN="uv"
        else
            echo "Error: uv not found and no local venv. Install uv or create .venv." >&2
            exit 1
        fi
    fi
fi

# Make Python output unbuffered for timely logs in KM debug window
export PYTHONUNBUFFERED=1

# Preflight: detect Chrome remote-debugging flag without invoking Python/uv to
# avoid any chance of resolver delays in Keyboard Maestro.
ps_output=$(ps -axo pid,command 2>/dev/null | grep -E "Google Chrome( Helper)?|Google Chrome Beta( Helper)?|Google Chrome Canary( Helper)?" | grep -v grep || true)
if [ -n "$ps_output" ]; then
    if ! printf "%s" "$ps_output" | grep -q -- "--remote-debugging-port"; then
        {
            echo "Error: Chrome is running without --remote-debugging-port."
            echo "LLM Burst cannot attach in this state."
            echo ""
            echo "How to fix:"
            echo "  - Quit Chrome, then run: uv run llm-burst chrome-launch"
            echo "    (or start Chrome with: --remote-debugging-port=9222)"
        } >&2
        exit 2
    fi
fi

# Decide how to supply the prompt to avoid any GUI in KM.
# If caller already provided --stdin/-s or --prompt-text/-m, just pass through.
needs_prompt_via_stdin=true
for arg in "$@"; do
    case "$arg" in
        -s|--stdin|-m|--prompt-text)
            needs_prompt_via_stdin=false
            break
            ;;
    esac
done

if [ "$needs_prompt_via_stdin" = true ]; then
    # Use clipboard content as the prompt to avoid GUI dialogs from JXA
    if command -v pbpaste >/dev/null 2>&1; then
        CLIPBOARD_CONTENT=$(pbpaste)
    else
        CLIPBOARD_CONTENT=""
    fi

    if [ -z "$CLIPBOARD_CONTENT" ]; then
        {
            echo "Error: No prompt provided and clipboard is empty."
            echo "Usage: copy text to clipboard or call with -m 'text' or --stdin."
        } >&2
        exit 3
    fi

    if [ -n "$LLM_BURST_BIN" ]; then
        # Use --prompt-text instead of --stdin to avoid the hanging issue
        "$LLM_BURST_BIN" activate --prompt-text "$CLIPBOARD_CONTENT" "$@"
    else
        "$UV_BIN" run llm-burst activate --prompt-text "$CLIPBOARD_CONTENT" "$@"
    fi
    exit $?
fi

# Caller provided prompt flags; run directly (no GUI)
if [ -n "$LLM_BURST_BIN" ]; then
    exec "$LLM_BURST_BIN" activate "$@"
else
    exec "$UV_BIN" run llm-burst activate "$@"
fi
