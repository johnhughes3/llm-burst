"""
Simple test to check Grok submit button appearance.
"""

import asyncio
from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider


async def test_grok_submit():
    """Test submit button appearance after text entry."""
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-grok", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(3000)

        print("\n=== STEP 1: Initial check ===")
        initial = await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                const submitBtn = document.querySelector('button[type="submit"]');
                return {
                    hasEditor: !!editor,
                    hasSubmitButton: !!submitBtn
                };
            }
        """)
        print(f"Initial: {initial}")

        print("\n=== STEP 2: Enter text via JavaScript ===")
        await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                if (editor) {
                    // Focus the editor
                    editor.focus();
                    editor.click();
                    
                    // Set text content
                    editor.textContent = "Hello, world! Test message.";
                    
                    // Dispatch input event to trigger React
                    editor.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        cancelable: true,
                        data: "Hello, world! Test message."
                    }));
                }
            }
        """)

        await page.wait_for_timeout(1000)

        print("\n=== STEP 3: Check after text entry ===")
        after = await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                const buttons = Array.from(document.querySelectorAll('button'));
                
                // Look for submit button with various strategies
                const submitBtn = buttons.find(btn => 
                    btn.type === 'submit' || 
                    btn.getAttribute('aria-label') === 'Submit' ||
                    btn.getAttribute('aria-label') === 'Send'
                );
                
                // Also check form buttons
                const form = document.querySelector('form');
                const formButtons = form ? Array.from(form.querySelectorAll('button')) : [];
                
                return {
                    editorText: editor ? editor.textContent : null,
                    totalButtons: buttons.length,
                    hasSubmitButton: !!submitBtn,
                    submitDetails: submitBtn ? {
                        type: submitBtn.type,
                        ariaLabel: submitBtn.getAttribute('aria-label'),
                        disabled: submitBtn.disabled
                    } : null,
                    formButtonCount: formButtons.length,
                    formButtons: formButtons.slice(0, 5).map(btn => ({
                        type: btn.type,
                        ariaLabel: btn.getAttribute('aria-label')
                    }))
                };
            }
        """)
        print(f"After text: {after}")

        # If submit button found, try clicking it
        if after["hasSubmitButton"]:
            print("\n=== STEP 4: Click submit ===")
            await page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const submitBtn = buttons.find(btn => 
                        btn.type === 'submit' || 
                        btn.getAttribute('aria-label') === 'Submit'
                    );
                    if (submitBtn && !submitBtn.disabled) {
                        submitBtn.click();
                    }
                }
            """)
            await page.wait_for_timeout(2000)
            print("Submit clicked!")

        await page.screenshot(path="tests/assets/screenshots/grok_submit_test.png")
        print("\nScreenshot saved!")


if __name__ == "__main__":
    asyncio.run(test_grok_submit())
