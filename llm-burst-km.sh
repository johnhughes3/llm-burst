#!/bin/bash

# LLM Burst launcher for Keyboard Maestro and terminal use
# Optimized for reliability in limited PATH environments

set -e  # Exit on error

# Navigate to project directory
cd "$(dirname "$0")"

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
        echo "Error: uv not found. Please install: https://github.com/astral-sh/uv" >&2
        exit 1
    fi
fi

# Launch LLM Burst with GUI prompt
exec "$UV_BIN" run llm-burst activate --gui-prompt "$@"