#!/bin/bash
# End-to-end test script for llm-burst

echo "🚀 Starting llm-burst end-to-end test..."
echo ""

# Clean up any existing state
echo "📧 Cleaning up existing state..."
rm -f ~/.config/llm-burst/state.json

# Test 1: Open windows
echo ""
echo "📂 Test 1: Opening 4 LLM windows..."
uv run llm-burst open "E2E Test Claude" --provider claude
sleep 2
uv run llm-burst open "E2E Test Gemini" --provider gemini
sleep 2
uv run llm-burst open "E2E Test ChatGPT" --provider chatgpt
sleep 2
uv run llm-burst open "E2E Test Grok" --provider grok
sleep 2

# Test 2: List sessions
echo ""
echo "📝 Test 2: Listing sessions..."
uv run llm-burst list

# Test 3: Arrange windows (requires Rectangle.app)
echo ""
echo "🔲 Test 3: Arranging windows with Rectangle..."
uv run llm-burst arrange
sleep 2

# Test 4: Create tab group
echo ""
echo "📁 Test 4: Creating tab group..."
uv run llm-burst group create "E2E Test Group"
sleep 2

# List to show grouped state
echo ""
echo "📝 Listing sessions (grouped)..."
uv run llm-burst list

# Test 5: Remove tab group
echo ""
echo "📤 Test 5: Removing tab group..."
uv run llm-burst group remove "E2E Test Group"
sleep 2

# Test 6: Close one window
echo ""
echo "❌ Test 6: Closing one window..."
uv run llm-burst stop "E2E Test Claude"
sleep 1

# Final list
echo ""
echo "📝 Final session list:"
uv run llm-burst list

echo ""
echo "✅ End-to-end test complete!"
echo ""
echo "To clean up all remaining windows, run:"
echo "  uv run llm-burst stop --all"