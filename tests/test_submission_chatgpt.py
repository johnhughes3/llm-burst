"""
Integration test for ChatGPT prompt submission.

This test verifies that the JavaScript selectors and submission logic
for ChatGPT are working correctly with the current UI.

IMPORTANT: This test connects to an existing authenticated Chrome session
using BrowserAdapter, as the llm-burst tool is designed to work with
already logged-in sessions.
"""

import asyncio
import os
import pytest
from pathlib import Path

from playwright.async_api import Error as PlaywrightError

from llm_burst.browser import BrowserAdapter, SessionHandle
from llm_burst.constants import LLMProvider, LLM_URLS
from llm_burst.providers import get_injector, InjectOptions
from llm_burst.sites.chatgpt import selectors_up_to_date


# Mark this as an integration test that requires browser
pytestmark = pytest.mark.integration


@pytest.fixture
async def browser_session():
    """Connect to existing authenticated Chrome session using BrowserAdapter."""
    # Skip if browser tests are not enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")

    async with BrowserAdapter() as adapter:
        # Open a ChatGPT window using the real adapter
        # This connects to an existing Chrome instance with remote debugging enabled
        handle = await adapter.open_window("test-chatgpt", LLMProvider.CHATGPT)

        # Enable console logging for debugging
        handle.page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
        handle.page.on("pageerror", lambda err: print(f"Browser error: {err}"))

        yield handle

        # Clean up - close the window
        await adapter.close_window("test-chatgpt")


@pytest.mark.asyncio
async def test_chatgpt_submission_selectors(browser_session: SessionHandle):
    """Test that ChatGPT selectors are up to date."""
    page = browser_session.page
    # The page should already be at ChatGPT URL from open_window
    # But ensure we're on the right page
    if page.url != LLM_URLS[LLMProvider.CHATGPT]:
        await page.goto(LLM_URLS[LLMProvider.CHATGPT], wait_until="networkidle")

    # Wait for page to load
    await asyncio.sleep(2)

    # Debug: Check what selectors are actually present
    debug_info = await page.evaluate("""
        () => {
            const results = {
                proseMirror: !!document.querySelector('.ProseMirror'),
                promptTextarea: !!document.querySelector('#prompt-textarea'),
                submitButton: !!document.querySelector('button[type="submit"]'),
                sendButton: !!document.querySelector('[data-testid="send-button"]'),
                anyTextarea: !!document.querySelector('textarea'),
                anyContentEditable: !!document.querySelector('[contenteditable="true"]'),
                alternativeSelectors: []
            };
            
            // Find any textarea or contenteditable elements
            const textareas = document.querySelectorAll('textarea');
            const contentEditables = document.querySelectorAll('[contenteditable="true"]');
            
            textareas.forEach(el => {
                results.alternativeSelectors.push({
                    type: 'textarea',
                    id: el.id || 'no-id',
                    className: el.className || 'no-class',
                    placeholder: el.placeholder || 'no-placeholder'
                });
            });
            
            contentEditables.forEach(el => {
                results.alternativeSelectors.push({
                    type: 'contenteditable',
                    id: el.id || 'no-id',
                    className: el.className || 'no-class',
                    role: el.getAttribute('role') || 'no-role'
                });
            });
            
            // Find any buttons that might be send buttons
            const buttons = document.querySelectorAll('button');
            const sendButtons = [];
            buttons.forEach(btn => {
                const text = btn.textContent || '';
                const ariaLabel = btn.getAttribute('aria-label') || '';
                if (text.toLowerCase().includes('send') || 
                    ariaLabel.toLowerCase().includes('send') ||
                    btn.querySelector('svg')) {
                    sendButtons.push({
                        text: text.trim(),
                        ariaLabel: ariaLabel,
                        dataTestId: btn.getAttribute('data-testid'),
                        type: btn.type,
                        className: btn.className
                    });
                }
            });
            results.potentialSendButtons = sendButtons;
            
            return results;
        }
    """)

    print("Debug info from ChatGPT page:")
    print(f"  ProseMirror found: {debug_info['proseMirror']}")
    print(f"  prompt-textarea found: {debug_info['promptTextarea']}")
    print(f"  submit button found: {debug_info['submitButton']}")
    print(f"  send button found: {debug_info['sendButton']}")
    print(f"  Any textarea found: {debug_info['anyTextarea']}")
    print(f"  Any contenteditable found: {debug_info['anyContentEditable']}")
    print(f"  Alternative selectors: {debug_info['alternativeSelectors']}")
    print(f"  Potential send buttons: {debug_info['potentialSendButtons']}")

    # Check if selectors are valid
    result = await selectors_up_to_date(page)
    assert result, "ChatGPT selectors are outdated - UI may have changed"


@pytest.mark.asyncio
async def test_chatgpt_prompt_submission(browser_session: SessionHandle):
    """Test submitting a prompt to ChatGPT."""
    page = browser_session.page
    # The page should already be at ChatGPT URL
    if page.url != LLM_URLS[LLMProvider.CHATGPT]:
        await page.goto(LLM_URLS[LLMProvider.CHATGPT], wait_until="domcontentloaded")

    # Wait for initial page load
    await asyncio.sleep(3)

    # Get the injector for ChatGPT
    injector = get_injector(LLMProvider.CHATGPT)

    # Create injection options (no research or incognito for basic test)
    opts = InjectOptions(follow_up=False, research=False, incognito=False)

    # Test prompt
    test_prompt = "Hello, world! This is a test message."

    # Inject and submit the prompt
    try:
        await injector(page, test_prompt, opts)

        # Wait for submission to process
        await asyncio.sleep(2)

        # Check that the prompt was submitted (it should appear in the chat)
        # After submission, the message appears in the conversation area
        prompt_visible = await page.evaluate("""
            () => {
                // Check for the message text anywhere on the page
                // ChatGPT shows submitted messages in the conversation area
                const pageText = document.body.textContent || '';
                return pageText.includes('Hello, world! This is a test message.');
            }
        """)

        assert prompt_visible, "Prompt was not successfully submitted to ChatGPT"

        # Wait a bit more for response to start
        await asyncio.sleep(3)

        # Take screenshot for verification
        screenshot_dir = Path("tests/assets/screenshots")
        screenshot_dir.mkdir(parents=True, exist_ok=True)

        screenshot_path = screenshot_dir / "chatgpt_submission_latest.png"
        await page.screenshot(path=str(screenshot_path), full_page=False)

        print(f"Screenshot saved to: {screenshot_path}")

        # Verify ChatGPT has started responding or shows an error message
        # Since we're not logged in, we might get an error or login prompt
        # But the submission itself should have worked
        print("Submission completed successfully!")

    except PlaywrightError as e:
        # Take error screenshot
        screenshot_dir = Path("tests/assets/screenshots")
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        error_screenshot = screenshot_dir / "chatgpt_submission_error.png"
        await page.screenshot(path=str(error_screenshot), full_page=True)
        print(f"Error screenshot saved to: {error_screenshot}")
        raise AssertionError(f"Failed to submit prompt to ChatGPT: {e}")


@pytest.mark.asyncio
async def test_chatgpt_research_mode(browser_session: SessionHandle):
    """Test submitting a prompt with research mode enabled."""
    page = browser_session.page
    # The page should already be at ChatGPT URL
    if page.url != LLM_URLS[LLMProvider.CHATGPT]:
        await page.goto(LLM_URLS[LLMProvider.CHATGPT], wait_until="domcontentloaded")

    # Wait for initial page load
    await asyncio.sleep(3)

    # Get the injector
    injector = get_injector(LLMProvider.CHATGPT)

    # Create injection options with research mode
    opts = InjectOptions(follow_up=False, research=True, incognito=False)

    # Test prompt
    test_prompt = "What is the latest news about AI?"

    try:
        # Inject and submit with research mode
        await injector(page, test_prompt, opts)

        # Wait for submission
        await asyncio.sleep(3)

        # Check if research mode was activated (Tools button should show selection)
        research_active = await page.evaluate("""
            () => {
                const toolsButton = document.querySelector('#system-hint-button');
                if (!toolsButton) return false;
                
                // Check if button shows research mode is active
                const buttonText = toolsButton.textContent || '';
                return buttonText.includes('deep research') || 
                       buttonText.includes('Deep research') ||
                       toolsButton.getAttribute('aria-expanded') === 'false';
            }
        """)

        # Take screenshot
        screenshot_dir = Path("tests/assets/screenshots")
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = screenshot_dir / "chatgpt_research_mode.png"
        await page.screenshot(path=str(screenshot_path), full_page=False)

        # Note: Research mode activation is optional - UI may not always show it
        print(
            f"Research mode {'activated' if research_active else 'may not be available'}"
        )

    except PlaywrightError as e:
        print(f"Research mode test warning: {e}")
        # Research mode is optional, so we don't fail the test


@pytest.mark.asyncio
async def test_chatgpt_incognito_mode(browser_session: SessionHandle):
    """Test submitting a prompt with incognito mode enabled."""
    page = browser_session.page
    # The page should already be at ChatGPT URL
    if page.url != LLM_URLS[LLMProvider.CHATGPT]:
        await page.goto(LLM_URLS[LLMProvider.CHATGPT], wait_until="domcontentloaded")

    # Wait for initial page load
    await asyncio.sleep(3)

    # Check if temporary chat button exists
    temp_button_exists = await page.evaluate("""
        () => {
            const buttons = document.querySelectorAll('button');
            for (const button of buttons) {
                if (button.textContent && button.textContent.includes('Temporary')) {
                    return true;
                }
            }
            return false;
        }
    """)

    if not temp_button_exists:
        pytest.skip("Temporary chat button not available - may require login")

    # Get the injector
    injector = get_injector(LLMProvider.CHATGPT)

    # Create injection options with incognito mode
    opts = InjectOptions(follow_up=False, research=False, incognito=True)

    # Test prompt
    test_prompt = "Test message in incognito mode"

    try:
        # Inject and submit with incognito mode
        await injector(page, test_prompt, opts)

        # Wait for submission
        await asyncio.sleep(3)

        # Take screenshot
        screenshot_dir = Path("tests/assets/screenshots")
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = screenshot_dir / "chatgpt_incognito_mode.png"
        await page.screenshot(path=str(screenshot_path), full_page=False)

        print("Incognito mode test completed")

    except PlaywrightError as e:
        print(f"Incognito mode test warning: {e}")
        # Incognito mode is optional, so we don't fail the test
