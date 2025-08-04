#!/bin/bash
# Setup script to create and configure the llm-burst Chrome profile
# Run this once to set up your Chrome profile with all necessary logins

echo "========================================="
echo "llm-burst Chrome Profile Setup"
echo "========================================="
echo ""
echo "This will launch Chrome with a dedicated llm-burst profile."
echo "Please log into the following services:"
echo "  1. Claude (claude.ai)"
echo "  2. ChatGPT (chatgpt.com)"
echo "  3. Gemini (gemini.google.com)"
echo "  4. Grok (grok.com)"
echo ""
echo "Your logins will be saved in this profile for future use."
echo ""
read -p "Press Enter to launch Chrome with the llm-burst profile..."

# Kill any existing Chrome instances
pkill -f "Google Chrome" 2>/dev/null
sleep 2

# Launch Chrome with the llm-burst profile and remote debugging
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome-LLMBurst" \
  --no-first-run \
  --no-default-browser-check &

echo ""
echo "Chrome launched with the llm-burst profile."
echo "Please:"
echo "  1. Log into all 4 LLM services"
echo "  2. Keep Chrome open while you test llm-burst"
echo ""
echo "To test llm-burst after logging in, run:"
echo "  uv run python -m llm_burst activate --prompt-text \"Hello!\""