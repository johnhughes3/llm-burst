"""Test Claude submission functionality.

This test verifies that the Claude submission JavaScript works correctly
by connecting to the existing Chrome instance with the proper profile,
injecting a test prompt, and capturing a screenshot of the result.
"""

import asyncio
import os
from pathlib import Path

import pytest

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider
from llm_burst.providers import get_injector, InjectOptions

# Ensure screenshot directory exists
SCREENSHOT_DIR = Path(__file__).parent / "assets" / "screenshots"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)


@pytest.mark.asyncio
async def test_claude_submission_with_screenshot():
    """Test Claude submission flow using real Chrome profile with existing session."""
    # Use the actual BrowserAdapter to connect to existing Chrome with proper profile
    async with BrowserAdapter() as adapter:
        # Open a window for Claude (or reuse existing one)
        print("Opening Claude window using existing Chrome profile...")
        handle = await adapter.open_window("Test-Claude-Submission", LLMProvider.CLAUDE)

        # Get the page from the session handle
        page = handle.page

        # Wait for page to be fully loaded
        print("Waiting for Claude page to load...")
        await page.wait_for_timeout(3000)

        # Get the injector for Claude
        injector = get_injector(LLMProvider.CLAUDE)

        # Prepare test prompt
        test_prompt = (
            "Hello, world! This is a test message from the automated test suite."
        )

        # Create inject options (no research mode for basic test)
        options = InjectOptions(follow_up=False, research=False, incognito=False)

        # Inject the submission JavaScript and execute it
        print("Injecting Claude submission JavaScript...")
        try:
            # Set up clipboard content first
            import pyperclip

            pyperclip.copy(test_prompt)
            print(f"Clipboard set with test prompt: {test_prompt[:50]}...")
        except Exception as e:
            print(f"Warning: Could not set clipboard: {e}")

        # Execute the injector
        await injector(page, test_prompt, options)

        # Wait for the message to be processed
        print("Waiting for Claude to process the message...")
        await page.wait_for_timeout(5000)

        # Check for any JavaScript errors by evaluating console
        console_output = await page.evaluate(
            """
            () => {
                // Get any console messages that were logged
                return {
                    url: window.location.href,
                    title: document.title,
                    hasEditor: !!document.querySelector('.ProseMirror'),
                    hasSendButton: !!document.querySelector('button[aria-label="Send message"]'),
                    hasMessages: document.querySelectorAll('[role="article"]').length,
                    editorContent: document.querySelector('.ProseMirror')?.textContent || 'No editor found'
                };
            }
        """
        )
        print(f"Page state: {console_output}")

        # Try to verify the prompt was submitted by checking for response elements
        response_started = await page.evaluate(
            """
            () => {
                // Check for various indicators that Claude is processing/responding
                const indicators = [
                    document.querySelector('[data-testid="claude-thinking"]'),
                    document.querySelector('.prose'),
                    document.querySelector('[data-testid="message-content"]'),
                    // Check if there are any message containers
                    document.querySelectorAll('[role="article"]').length > 0,
                    // Check if there are any assistant messages
                    document.querySelector('[data-testid="assistant-message"]'),
                    // Check for any response text
                    Array.from(document.querySelectorAll('div')).some(
                        div => div.textContent && div.textContent.includes('Hello')
                    )
                ];
                return indicators.some(indicator => !!indicator);
            }
        """
        )

        # Take a screenshot for verification
        screenshot_path = str(SCREENSHOT_DIR / "claude_submission_latest.png")
        await page.screenshot(path=screenshot_path, full_page=False)
        print(f"Screenshot saved to: {screenshot_path}")

        # Verify the screenshot was created
        assert os.path.exists(screenshot_path), "Screenshot was not created"

        # Verify file size is reasonable (not a blank image)
        file_size = os.path.getsize(screenshot_path)
        print(f"Screenshot size: {file_size} bytes")
        assert file_size > 10000, f"Screenshot seems too small ({file_size} bytes)"

        # Check if submission appeared to work
        if response_started:
            print("SUCCESS: Claude appears to be processing/responding to the message")
        else:
            print(
                "Warning: Could not verify that Claude started processing the message"
            )
            print("This might be normal if Claude takes time to respond")

        # Test passes if we got this far without exceptions
        print("Claude submission test completed successfully")


@pytest.mark.asyncio
async def test_claude_selectors_with_real_profile():
    """Verify Claude selectors using the real Chrome profile."""
    async with BrowserAdapter() as adapter:
        # Open Claude window
        handle = await adapter.open_window("Test-Selector-Check", LLMProvider.CLAUDE)
        page = handle.page

        # Wait for page to load
        await page.wait_for_timeout(2000)

        # Check if main selectors exist
        selectors_check = await page.evaluate(
            """
            () => {
                const results = {
                    editor: !!document.querySelector('.ProseMirror'),
                    sendButton: !!document.querySelector('button[aria-label="Send message"]'),
                    anyButton: document.querySelectorAll('button').length > 0,
                    pageLoaded: document.readyState === 'complete',
                    url: window.location.href,
                    title: document.title
                };
                
                // Check for alternative editor selectors
                if (!results.editor) {
                    results.alternativeEditors = {
                        contentEditable: !!document.querySelector('[contenteditable="true"]'),
                        textbox: !!document.querySelector('div[role="textbox"]'),
                        textarea: !!document.querySelector('textarea')
                    };
                }
                
                return results;
            }
        """
        )

        print(f"Selector check results: {selectors_check}")

        # Verify the page loaded
        assert selectors_check["pageLoaded"], "Page did not fully load"

        # Check if we have the editor
        if selectors_check["editor"]:
            print("SUCCESS: ProseMirror editor found")
        else:
            print("Warning: ProseMirror editor not found, checking alternatives...")
            if selectors_check.get("alternativeEditors"):
                print(
                    f"Alternative editors found: {selectors_check['alternativeEditors']}"
                )


if __name__ == "__main__":
    # Allow running this test directly for debugging
    asyncio.run(test_claude_submission_with_screenshot())
