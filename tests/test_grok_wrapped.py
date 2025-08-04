"""
Test Grok with JavaScript wrapped in IIFE to prevent conflicts.
"""

import asyncio
import os

import pytest

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider
from llm_burst.sites.grok import SUBMIT_JS


@pytest.mark.asyncio
async def test_grok_wrapped():
    """Test with JavaScript wrapped in IIFE."""
    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-wrapped", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== TEST: Load JavaScript wrapped in IIFE ===")

        # Wrap the entire JavaScript in an IIFE to prevent scope leakage
        wrapped_js = f"""
        (function() {{
            {SUBMIT_JS}
        }})();
        """

        try:
            await page.evaluate(wrapped_js)
            print("✓ JavaScript loaded successfully with IIFE wrapper!")

            # Check if functions are available globally
            check = await page.evaluate("""
                () => ({
                    hasAutomateGrokChat: typeof window.automateGrokChat === 'function',
                    hasLlmBurstWait: typeof window.llmBurstWait === 'function',
                    hasLlmBurstWaitUntil: typeof window.llmBurstWaitUntil === 'function'
                })
            """)
            print(f"Function availability: {check}")

        except Exception as e:
            print(f"✗ Failed even with IIFE wrapper: {e}")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_wrapped_test.png")
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_wrapped())
