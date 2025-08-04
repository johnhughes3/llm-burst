"""
Debug test to understand Grok's submit button behavior.
"""

import asyncio
from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider


async def test_grok_submit_flow():
    """Test the actual submission flow step by step."""
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-grok-submit", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        print("\n=== INITIAL STATE ===")

        # Check initial state
        initial_state = await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                const submitBtn = document.querySelector('button[type="submit"]');
                return {
                    hasEditor: !!editor,
                    editorText: editor ? editor.textContent : null,
                    hasSubmitButton: !!submitBtn,
                    submitDisabled: submitBtn ? submitBtn.disabled : null,
                    buttonCount: document.querySelectorAll('button').length
                };
            }
        """)
        print(f"Initial state: {initial_state}")

        # Focus and type into the contenteditable
        print("\n=== TYPING TEXT ===")

        await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                if (editor) {
                    editor.focus();
                    editor.click();
                }
            }
        """)

        await page.wait_for_timeout(500)

        # Type text using keyboard
        await page.keyboard.type("Hello, world! Test message.")
        await page.wait_for_timeout(1000)

        # Check state after typing
        after_typing = await page.evaluate("""
            () => {
                const editor = document.querySelector('[contenteditable="true"]');
                const buttons = Array.from(document.querySelectorAll('button'));
                const submitBtns = buttons.filter(btn => 
                    btn.type === 'submit' || 
                    btn.getAttribute('aria-label')?.toLowerCase().includes('submit') ||
                    btn.getAttribute('aria-label')?.toLowerCase().includes('send')
                );
                
                return {
                    editorText: editor ? editor.textContent : null,
                    buttonCount: buttons.length,
                    submitButtons: submitBtns.map(btn => ({
                        type: btn.type,
                        ariaLabel: btn.getAttribute('aria-label'),
                        className: btn.className.substring(0, 100),
                        disabled: btn.disabled,
                        hasIcon: !!btn.querySelector('svg')
                    }))
                };
            }
        """)
        print(f"After typing: {after_typing}")

        # Look for any button that might be submit
        print("\n=== SEARCHING FOR SUBMIT BUTTON ===")

        all_buttons = await page.evaluate("""
            () => {
                const buttons = Array.from(document.querySelectorAll('button'));
                return buttons.slice(-5).map(btn => ({  // Last 5 buttons
                    type: btn.type,
                    ariaLabel: btn.getAttribute('aria-label'),
                    text: btn.textContent?.trim().substring(0, 30),
                    className: btn.className.substring(0, 60),
                    disabled: btn.disabled,
                    hasIcon: !!btn.querySelector('svg'),
                    isVisible: btn.offsetParent !== null
                }));
            }
        """)
        print("Last 5 buttons on page:")
        for i, btn in enumerate(all_buttons):
            print(f"  Button {i}: {btn}")

        # Check if there's a form and what's in it
        print("\n=== FORM ANALYSIS ===")
        form_info = await page.evaluate("""
            () => {
                const form = document.querySelector('form');
                if (!form) return { hasForm: false };
                
                const formButtons = Array.from(form.querySelectorAll('button'));
                return {
                    hasForm: true,
                    buttonCount: formButtons.length,
                    buttons: formButtons.map(btn => ({
                        type: btn.type,
                        ariaLabel: btn.getAttribute('aria-label'),
                        disabled: btn.disabled
                    }))
                };
            }
        """)
        print(f"Form info: {form_info}")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_after_typing.png")
        print("\nScreenshot saved to tests/assets/screenshots/grok_after_typing.png")


if __name__ == "__main__":
    asyncio.run(test_grok_submit_flow())
