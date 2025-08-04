"""
Minimal test to see if defining window.waitUntil causes conflicts.
"""

import asyncio
from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider


async def test_grok_minimal():
    """Test if defining window.waitUntil causes issues."""
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-minimal", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== TEST 1: Page works without our functions ===")

        # Check page state
        state1 = await page.evaluate("""
            () => ({
                hasEditor: !!document.querySelector('[contenteditable="true"]'),
                hasWaitUntil: typeof window.waitUntil
            })
        """)
        print(f"Initial state: {state1}")

        print("\n=== TEST 2: Define our wait function (safe) ===")

        # Define just wait (shouldn't conflict)
        await page.evaluate("""
            window.llmBurstWait = function(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            }
        """)

        state2 = await page.evaluate("""
            () => ({
                hasEditor: !!document.querySelector('[contenteditable="true"]'),
                hasLlmBurstWait: typeof window.llmBurstWait
            })
        """)
        print(f"After defining llmBurstWait: {state2}")

        print("\n=== TEST 3: Define window.waitUntil (may conflict) ===")

        try:
            # This might cause the error
            await page.evaluate("""
                window.waitUntil = function(condition, timeout = 3000, interval = 100) {
                    return new Promise((resolve, reject) => {
                        const startTime = Date.now();
                        
                        const checkCondition = () => {
                            try {
                                const result = condition();
                                if (result) {
                                    resolve(result);
                                    return;
                                }
                            } catch (e) {
                                // Ignore errors in condition function during polling
                            }
                            
                            if (Date.now() - startTime > timeout) {
                                reject(new Error("Timeout waiting for condition"));
                                return;
                            }
                            
                            setTimeout(checkCondition, interval);
                        };
                        
                        checkCondition();
                    });
                }
            """)
            print("Successfully defined window.waitUntil")
        except Exception as e:
            print(f"Error defining window.waitUntil: {e}")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_minimal_test.png")
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_minimal())
