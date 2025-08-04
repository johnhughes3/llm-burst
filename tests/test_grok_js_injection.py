"""
Test the actual Grok JavaScript injection to debug timeout issues.
"""

import asyncio
from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider
from llm_burst.sites.grok import SUBMIT_JS


async def test_grok_js_injection():
    """Test injecting and running the Grok submit JavaScript."""
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-js-injection", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== TESTING JAVASCRIPT INJECTION ===")

        # First check what's on the page
        page_state = await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                const form = document.querySelector('form');
                const textarea = document.querySelector('textarea');
                
                return {
                    hasContentEditable: !!editor,
                    contentEditableClass: editor ? editor.className : null,
                    hasForm: !!form,
                    hasTextarea: !!textarea,
                    url: window.location.href
                };
            }
        """)
        print(f"Page state: {page_state}")

        # Now inject and run our JavaScript
        print("\n=== INJECTING SUBMIT_JS ===")

        # Inject the JavaScript with a test prompt
        try:
            result = await page.evaluate(
                f"""
                (async () => {{
                    const userPrompt = "Test message from JavaScript injection";
                    const research = false;
                    const incognito = false;
                    
                    {SUBMIT_JS}
                    
                    // Call the main function
                    return await window.automateGrokChat(userPrompt, research, incognito);
                }})()
                """
            )
            print(f"JavaScript execution result: {result}")
        except Exception as e:
            print(f"JavaScript execution error: {e}")

            # Try to get more specific error info
            error_details = await page.evaluate("""
                () => {
                    // Check if our functions were defined
                    return {
                        hasAutomateGrokChat: typeof window.automateGrokChat === 'function',
                        hasFindAndPrepareTextarea: typeof window.findAndPrepareTextarea === 'function',
                        hasClickSubmitButton: typeof window.clickSubmitButton === 'function',
                        hasConfigureChatModes: typeof window.configureChatModes === 'function',
                        hasSendPromptToGrok: typeof window.sendPromptToGrok === 'function'
                    };
                }
            """)
            print(f"Function availability: {error_details}")

        # Take screenshot
        await page.screenshot(
            path="tests/assets/screenshots/grok_js_injection_test.png"
        )
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_js_injection())
