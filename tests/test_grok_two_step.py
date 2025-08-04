"""
Test Grok JavaScript injection using the exact two-step process from llm-burst.
"""

import asyncio
import json
import os

import pytest

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider
from llm_burst.sites.grok import SUBMIT_JS


@pytest.mark.asyncio
async def test_grok_two_step():
    """Test the two-step injection process used by llm-burst."""
    # Skip test if not explicitly enabled
    if not os.environ.get("ENABLE_BROWSER_TESTS"):
        pytest.skip("Browser tests disabled. Set ENABLE_BROWSER_TESTS=1 to run.")
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-two-step", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== STEP 1: Load JavaScript ===")

        # Step 1: Load the JavaScript (like _build_injector does)
        await page.evaluate(SUBMIT_JS)

        # Check if functions are available
        check1 = await page.evaluate("""
            () => ({
                hasAutomateGrokChat: typeof window.automateGrokChat === 'function',
                hasWait: typeof window.wait === 'function',
                hasWaitUntil: typeof window.waitUntil === 'function'
            })
        """)
        print(f"After loading JS: {check1}")

        print("\n=== STEP 2: Call function ===")

        # Step 2: Call the function (like _build_injector does)
        prompt = "Test message from two-step process"
        research = "'No'"
        incognito = "'No'"

        call_expr = f"automateGrokChat({json.dumps(prompt)}, {research}, {incognito})"

        try:
            result = await page.evaluate(
                f"(async () => {{ try {{ await {call_expr}; }} catch(e) {{ console.error(e); throw e; }} }})()"
            )
            print(f"Function call result: {result}")
        except Exception as e:
            print(f"Function call error: {e}")

            # Try to get more error details
            error_info = await page.evaluate("""
                () => {
                    // Check page state
                    const editor = document.querySelector('[contenteditable="true"]');
                    const form = document.querySelector('form');
                    
                    return {
                        hasEditor: !!editor,
                        editorClass: editor ? editor.className.substring(0, 100) : null,
                        hasForm: !!form,
                        functionsAvailable: {
                            automateGrokChat: typeof window.automateGrokChat,
                            wait: typeof window.wait,
                            waitUntil: typeof window.waitUntil
                        }
                    };
                }
            """)
            print(f"Page state after error: {error_info}")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_two_step_test.png")
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_two_step())
