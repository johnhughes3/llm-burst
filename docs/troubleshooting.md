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

**Issue**: swiftDialog may trigger a Finder error (-50) on some macOS systems due to code signing or security restrictions. This happens even when swiftDialog works correctly.

**Solution**: The application includes multiple fallback mechanisms:

1. **Automatic Fallback** (v1.2.0+): The safe wrapper (`swift_prompt_safe.sh`) detects the -50 error and automatically falls back to using clipboard content:
   ```
   SwiftDialog error detected, using clipboard fallback...
   ```

2. **Silent Error Suppression**: The Python code filters out the -50 error from stderr to avoid confusion.

3. **Manual Fix Options**:
   - **Option A**: Re-install swiftDialog via Homebrew:
     ```bash
     brew uninstall swiftdialog
     brew install --cask swiftdialog
     ```
   
   - **Option B**: Clear quarantine attributes:
     ```bash
     sudo xattr -cr /usr/local/bin/dialog
     ```
   
   - **Option C**: Allow in System Preferences:
     - Go to System Preferences → Security & Privacy → General
     - Click "Allow Anyway" if swiftDialog appears there
   
   - **Option D**: Use the clipboard fallback exclusively by setting:
     ```bash
     export LLM_BURST_NO_DIALOG=1
     ```

**Note**: The -50 error doesn't prevent llm-burst from working correctly. The application will use clipboard content as the prompt source when the dialog fails.

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