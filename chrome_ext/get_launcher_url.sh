#!/bin/bash
# Script to get the LLM Burst launcher URL for Keyboard Maestro

# Get the extension ID from Chrome's extension management
# The ID is stable once installed from a packed extension or the Chrome Web Store
# For unpacked extensions in development, it changes based on the absolute path

echo "To get your LLM Burst launcher URL:"
echo ""
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Find 'LLM Burst Helper' and copy its ID"
echo "3. Your launcher URL will be:"
echo "   chrome-extension://[EXTENSION_ID]/launcher.html"
echo ""
echo "Example:"
echo "   chrome-extension://abcdefghijklmnopqrstuvwxyz123456/launcher.html"
echo ""
echo "Use this URL in your Keyboard Maestro macro to open the launcher page directly."