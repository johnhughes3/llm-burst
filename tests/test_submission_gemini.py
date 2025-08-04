"""
Test Gemini submission flow using the real llm-burst environment.

This test verifies that the JavaScript selectors and submission logic
for Gemini are working correctly with the current UI in a real,
authenticated browser session.
"""

import asyncio
import os
import subprocess
import time
from pathlib import Path

import pytest
from playwright.async_api import async_playwright

from llm_burst.cli import open_llm_window, send_prompt_sync
from llm_burst.constants import LLMProvider
from llm_burst.state import StateManager

# Test configuration
SCREENSHOTS_DIR = Path("tests/assets/screenshots")
TEST_PROMPT = "Hello, world! Please respond with just 'Hi there!'"
SUBMISSION_TIMEOUT = 30  # seconds
RESPONSE_WAIT_TIME = 10  # seconds to wait for response


def test_gemini_submission_real_environment():
    """Test Gemini submission in a real, authenticated browser session."""
    # Ensure screenshots directory exists
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")

    # Clean up any existing test session
    state = StateManager()
    if state.get("Test-Gemini-Real"):
        state.remove("Test-Gemini-Real")

    try:
        # Use the real llm-burst CLI to open a Gemini window
        print("Opening Gemini window using llm-burst CLI...")
        handle = open_llm_window("Test-Gemini-Real", LLMProvider.GEMINI)

        # Give the page time to load
        time.sleep(5)

        # Send the test prompt using the real submission flow
        print(f"Sending test prompt: {TEST_PROMPT}")
        send_prompt_sync(handle, TEST_PROMPT)

        # Wait for the response to be generated
        print(f"Waiting {RESPONSE_WAIT_TIME} seconds for response...")
        time.sleep(RESPONSE_WAIT_TIME)

        # Take a screenshot for verification
        asyncio.run(_take_screenshot(handle))

        print("✓ Gemini submission test completed successfully")
        print(f"Screenshot saved to {SCREENSHOTS_DIR / 'gemini_submission_latest.png'}")

    except Exception as e:
        # Clean up on failure
        if state.get("Test-Gemini-Real"):
            state.remove("Test-Gemini-Real")
        raise AssertionError(f"Gemini submission test failed: {e}")

    finally:
        # Clean up test session
        if state.get("Test-Gemini-Real"):
            state.remove("Test-Gemini-Real")


async def _take_screenshot(handle):
    """Take a screenshot of the current page."""
    async with async_playwright() as p:
        # Connect to the existing browser
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")

        # Find the page by target_id
        contexts = browser.contexts
        page = None

        for context in contexts:
            for p in context.pages:
                if hasattr(p, "_target_id") and p._target_id == handle.live.target_id:
                    page = p
                    break
            if page:
                break

        if page:
            screenshot_path = SCREENSHOTS_DIR / "gemini_submission_latest.png"
            await page.screenshot(path=screenshot_path, full_page=False)

        await browser.close()


@pytest.mark.asyncio
async def test_gemini_selectors_in_real_session():
    """Verify that key Gemini selectors exist in a real authenticated session."""
    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")

    # Clean up any existing test session
    state = StateManager()
    if state.get("Test-Gemini-Selectors"):
        state.remove("Test-Gemini-Selectors")

    try:
        # Open a real Gemini window
        handle = open_llm_window("Test-Gemini-Selectors", LLMProvider.GEMINI)

        # Give the page time to load
        await asyncio.sleep(5)

        # Connect to the browser and check selectors
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp("http://localhost:9222")

            # Find the page
            page = None
            for context in browser.contexts:
                for p in context.pages:
                    if (
                        hasattr(p, "_target_id")
                        and p._target_id == handle.live.target_id
                    ):
                        page = p
                        break
                if page:
                    break

            if not page:
                raise AssertionError("Could not find Gemini page")

            # Check for key selectors
            selectors_check = await page.evaluate(
                """
                () => {
                    const results = {};
                    
                    // Check for editor
                    results.editor = document.querySelector('.ql-editor') !== null;
                    
                    // Check for send button
                    results.sendButton = document.querySelector('button.send-button') !== null;
                    
                    // Check for model selector patterns
                    const buttons = Array.from(document.querySelectorAll('button'));
                    results.hasModelButton = buttons.some(b => {
                        const text = b.textContent || '';
                        return text.includes('Gemini') || 
                               text.includes('Pro') || 
                               text.includes('Flash');
                    });
                    
                    // Additional debug info
                    results.pageTitle = document.title;
                    results.url = window.location.href;
                    
                    return results;
                }
            """
            )

            print(f"Selector check results: {selectors_check}")

            # Take a debug screenshot
            await page.screenshot(path=SCREENSHOTS_DIR / "gemini_selectors_check.png")

            await browser.close()

            # Verify selectors exist
            assert selectors_check.get(
                "editor"
            ), "Editor selector '.ql-editor' not found"
            assert selectors_check.get(
                "sendButton"
            ), "Send button selector 'button.send-button' not found"

    finally:
        # Clean up test session
        if state.get("Test-Gemini-Selectors"):
            state.remove("Test-Gemini-Selectors")


def test_gemini_submission_via_cli():
    """Test Gemini submission using the llm-burst CLI directly."""
    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")

    # Ensure screenshots directory exists
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    try:
        # Use llm-burst CLI to activate windows with test prompt
        print("Activating windows via CLI...")
        result = subprocess.run(
            [
                "uv",
                "run",
                "llm-burst",
                "activate",
                "--title",
                "Test-Gemini-CLI",
                "--prompt-text",
                TEST_PROMPT,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )

        if result.returncode != 0:
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            raise AssertionError(f"CLI activation failed with code {result.returncode}")

        print("✓ CLI activation successful")

        # Wait for response
        time.sleep(RESPONSE_WAIT_TIME)

        # Clean up
        state = StateManager()
        if state.get("Test-Gemini-CLI"):
            state.remove("Test-Gemini-CLI")

    except subprocess.TimeoutExpired:
        raise AssertionError("CLI activation timed out")
    except Exception as e:
        # Clean up on failure
        state = StateManager()
        if state.get("Test-Gemini-CLI"):
            state.remove("Test-Gemini-CLI")
        raise AssertionError(f"CLI test failed: {e}")
