"""
Test Grok with the fixed JavaScript (renamed functions).
"""

import asyncio
import json
import os

import pytest

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider

# Import fresh to get the updated SUBMIT_JS
import importlib
import llm_burst.sites.grok as grok_module

importlib.reload(grok_module)


@pytest.mark.asyncio
async def test_grok_fixed():
    """Test the fixed Grok JavaScript with renamed functions."""
    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-fixed", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== STEP 1: Load Fixed JavaScript ===")

        # Step 1: Load the JavaScript (should not conflict now)
        try:
            await page.evaluate(grok_module.SUBMIT_JS)
            print("✓ JavaScript loaded successfully!")
        except Exception as e:
            print(f"✗ Failed to load JavaScript: {e}")
            return

        # Check if functions are available
        check1 = await page.evaluate("""
            () => ({
                hasAutomateGrokChat: typeof window.automateGrokChat === 'function',
                hasLlmBurstWait: typeof window.llmBurstWait === 'function',
                hasLlmBurstWaitUntil: typeof window.llmBurstWaitUntil === 'function',
                // Check that we didn't override Grok's functions
                hasOriginalWaitUntil: typeof window.waitUntil
            })
        """)
        print(f"Function availability: {check1}")

        print("\n=== STEP 2: Call Grok Automation ===")

        # Step 2: Call the function
        prompt = "Test message with fixed JavaScript"
        research = "'No'"
        incognito = "'No'"

        call_expr = f"automateGrokChat({json.dumps(prompt)}, {research}, {incognito})"

        try:
            result = await page.evaluate(
                f"(async () => {{ try {{ return await {call_expr}; }} catch(e) {{ console.error(e); throw e; }} }})()"
            )
            print(f"✓ Function call successful! Result: {result}")
        except Exception as e:
            print(f"✗ Function call failed: {e}")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_fixed_test.png")
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_fixed())
