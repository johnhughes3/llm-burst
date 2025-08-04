"""
Test Grok submission flow.

This integration test verifies that:
1. The Grok website can be loaded
2. JavaScript can be injected successfully
3. A prompt can be submitted
4. The submission triggers a response

The test generates a screenshot for visual verification.
"""

import os
from pathlib import Path
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider
from llm_burst.providers import get_injector, InjectOptions
from llm_burst.sites import grok


class TestGrokSubmission:
    """Test suite for Grok prompt submission functionality."""

    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not os.environ.get("RUN_BROWSER_TESTS"),
        reason="Requires real Chrome with authenticated Grok session. Set RUN_BROWSER_TESTS=1 to run."
    )
    async def test_grok_submission_integration(self):
        """
        Integration test for Grok prompt submission.

        IMPORTANT: This test requires:
        - A running Chrome instance with --remote-debugging-port=9222
        - An authenticated Grok session in that Chrome instance
        - Set RUN_BROWSER_TESTS=1 environment variable

        This test:
        1. Connects to existing Chrome with BrowserAdapter
        2. Opens/navigates to Grok
        3. Injects submission JavaScript
        4. Submits a test prompt
        5. Verifies submission worked
        6. Takes a screenshot
        """
        # Create screenshot directory
        screenshot_dir = Path("tests/assets/screenshots")
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = screenshot_dir / "grok_submission_latest.png"

        async with BrowserAdapter() as adapter:
            # Open Grok window
            handle = await adapter.open_window("test-grok-submission", LLMProvider.GROK)
            page = handle.page

            # Wait for page to fully load
            await page.wait_for_load_state("domcontentloaded")
            await page.wait_for_timeout(3000)  # Give UI time to initialize

            # Check if we need to handle any popups or login
            # This might fail if Grok requires authentication
            try:
                # Look for common popup close buttons
                close_button = await page.query_selector(
                    'button[aria-label*="close" i]'
                )
                if close_button:
                    await close_button.click()
                    await page.wait_for_timeout(500)
            except Exception:
                pass  # Ignore if no popup

            # Get the injector for Grok
            injector = get_injector(LLMProvider.GROK)

            # Configure injection options (basic submission, no special modes)
            opts = InjectOptions(follow_up=False, research=False, incognito=False)

            # Inject the JavaScript and submit prompt
            test_prompt = "Hello, world! This is a test message."

            try:
                await injector(page, test_prompt, opts)

                # Wait for submission to process
                # Look for indicators that submission is being processed
                await page.wait_for_timeout(2000)

                # Try multiple strategies to detect response
                response_started = False

                # Strategy 1: Look for typing indicators
                try:
                    await page.wait_for_selector(
                        '[class*="typing"], [class*="loading"], [class*="thinking"]',
                        timeout=5000,
                    )
                    response_started = True
                except Exception:
                    pass

                # Strategy 2: Look for message containers changing
                if not response_started:
                    try:
                        initial_messages = await page.query_selector_all(
                            '.message-item, [data-testid*="message"]'
                        )
                        initial_count = len(initial_messages)

                        await page.wait_for_function(
                            f"document.querySelectorAll('.message-item, [data-testid*=\"message\"]').length > {initial_count}",
                            timeout=5000,
                        )
                        response_started = True
                    except Exception:
                        pass

                # Strategy 3: Look for any text changes indicating response
                if not response_started:
                    try:
                        await page.wait_for_selector(
                            "text=/generating|thinking|typing|responding/i",
                            timeout=5000,
                        )
                        response_started = True
                    except Exception:
                        pass

                # Take screenshot regardless of response detection
                await page.screenshot(path=str(screenshot_path), full_page=False)

                # Verify submission was successful
                # Check if our prompt text appears somewhere on the page
                prompt_visible = await page.query_selector(f'text="{test_prompt[:20]}"')

                assert prompt_visible is not None or response_started, (
                    "Submission failed: prompt not visible and no response detected"
                )

            except Exception as e:
                # Take error screenshot
                await page.screenshot(
                    path=str(screenshot_path.with_suffix(".error.png"))
                )
                raise AssertionError(f"Grok submission failed: {e}")

    @pytest.mark.asyncio
    async def test_grok_selectors_smoke_test(self):
        """
        Unit test to verify Grok selectors are valid.

        This is a lightweight test that can run without a real browser.
        """
        # Create a mock page with expected HTML structure
        mock_page = MagicMock()

        # Set up the mock to return True for our selector check
        mock_page.evaluate.return_value = True

        # Test the selectors_up_to_date function
        result = grok.selectors_up_to_date(mock_page)

        assert result is True, "Grok selectors validation failed"

        # Verify the evaluate was called with the expected JavaScript
        mock_page.evaluate.assert_called_once()
        js_code = mock_page.evaluate.call_args[0][0]

        # Check that the JS contains our key selectors
        assert 'textarea[aria-label="Ask Grok anything"]' in js_code or 'contenteditable="true"' in js_code
        assert 'button[type="submit"]' in js_code

    @pytest.mark.asyncio
    async def test_grok_injector_configuration(self):
        """
        Test that Grok injector is properly configured.
        """
        # Get the injector
        injector = get_injector(LLMProvider.GROK)

        assert injector is not None, "Grok injector not found"
        assert callable(injector), "Grok injector is not callable"

        # Test with mock page
        mock_page = AsyncMock()
        opts = InjectOptions(research=True, incognito=True)

        await injector(mock_page, "test prompt", opts)

        # Verify evaluate was called (JS injection and execution)
        assert mock_page.evaluate.call_count == 2

        # Check that the automation function was called with correct parameters
        second_call = mock_page.evaluate.call_args_list[1][0][0]
        assert "automateGrokChat" in second_call
        assert "'Yes'" in second_call  # Research mode
        assert second_call.count("'Yes'") == 2  # Both research and incognito

    @pytest.mark.asyncio
    async def test_grok_followup_mode(self):
        """
        Test that follow-up mode uses correct JavaScript function.
        """
        mock_page = AsyncMock()

        # Test follow-up mode
        opts = InjectOptions(follow_up=True)
        injector = get_injector(LLMProvider.GROK)

        await injector(mock_page, "follow up message", opts)

        # Check that the follow-up function was called
        second_call = mock_page.evaluate.call_args_list[1][0][0]
        assert "grokFollowUpMessage" in second_call

        # Test normal mode
        opts = InjectOptions(follow_up=False)
        await injector(mock_page, "normal message", opts)

        # Check that the submit function was called
        fourth_call = mock_page.evaluate.call_args_list[3][0][0]
        assert "automateGrokChat" in fourth_call


@pytest.fixture
def mock_browser_adapter():
    """Mock BrowserAdapter for unit tests."""
    with patch("llm_burst.browser.BrowserAdapter") as mock:
        adapter = AsyncMock()
        mock.return_value.__aenter__.return_value = adapter
        mock.return_value.__aexit__.return_value = None
        yield adapter
