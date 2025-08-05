# llm-burst Troubleshooting

## Common Issues

### Grok Shows Text But Doesn't Submit / Grok Not Working

**Issue**: Grok (X's AI) requires you to be logged into X (Twitter) to function.

**Solution**: 
1. Open Chrome manually
2. Navigate to https://x.com
3. Log into your X/Twitter account
4. Try llm-burst again - Grok should now work

**Note**: The Chrome profile used by llm-burst (`~/Library/Application Support/Google/Chrome-LLMBurst`) needs to have an active X session. Once logged in, the session should persist across llm-burst uses.

### Gemini Not Showing Prompt Text

**Issue**: Gemini uses TrustedHTML which prevents direct innerHTML assignments.

**Status**: Fixed in latest version. The injection now uses DOM manipulation instead of innerHTML.

### macOS "The application can't be opened. -50" Error

**Issue**: swiftDialog may not be properly signed/notarized on some macOS systems.

**Solution**: The latest version includes a fallback that uses clipboard content when the dialog fails. You'll see:
```
Using clipboard content as prompt (dialog unavailable)
```

To fix swiftDialog permanently:
1. Install via Homebrew: `brew install swiftdialog`
2. Or download from https://github.com/swiftDialog/swiftDialog/releases
3. Ensure it's in your PATH

### Chrome Not Running with Remote Debugging

**Issue**: llm-burst requires Chrome to be running with `--remote-debugging-port=9222`

**Solution**: Use the built-in commands:
```bash
# Check Chrome status
uv run llm_burst chrome-status

# Manually relaunch Chrome with debugging
uv run llm_burst chrome-launch
```

The tool will also automatically prompt to relaunch Chrome when needed.