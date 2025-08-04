"""
Direct test to see what's actually on the Grok page.
"""

import asyncio
from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider


async def test_grok_page():
    """Check what elements are actually present on the Grok page."""
    async with BrowserAdapter() as adapter:
        # Open Grok window
        handle = await adapter.open_window("test-grok-direct", LLMProvider.GROK)
        page = handle.page

        # Wait for page to load
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(5000)

        # Check what's actually on the page
        result = await page.evaluate("""
            () => {
                const results = {
                    url: window.location.href,
                    title: document.title,
                    hasTextarea: !!document.querySelector('textarea'),
                    hasContentEditable: !!document.querySelector('[contenteditable="true"]'),
                    hasForm: !!document.querySelector('form'),
                    hasProseMirror: !!document.querySelector('.ProseMirror'),
                    hasSubmitButton: !!document.querySelector('button[type="submit"]'),
                    buttonCount: document.querySelectorAll('button').length,
                    contentEditableCount: document.querySelectorAll('[contenteditable="true"]').length,
                    contentEditableClasses: Array.from(document.querySelectorAll('[contenteditable="true"]')).map(el => el.className).slice(0, 3),
                    bodyText: document.body.innerText.substring(0, 500)
                };
                
                // Try to find any input-like elements
                const inputElements = Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], div[role="textbox"]'));
                results.inputElements = inputElements.map(el => ({
                    tag: el.tagName,
                    className: el.className.substring(0, 100),
                    id: el.id,
                    placeholder: el.placeholder || el.getAttribute('placeholder'),
                    ariaLabel: el.getAttribute('aria-label'),
                    contentEditable: el.contentEditable
                }));
                
                return results;
            }
        """)

        print("\n=== GROK PAGE ANALYSIS ===")
        print(f"URL: {result['url']}")
        print(f"Title: {result['title']}")
        print(f"Has textarea: {result['hasTextarea']}")
        print(f"Has contentEditable: {result['hasContentEditable']}")
        print(f"Has form: {result['hasForm']}")
        print(f"Has ProseMirror: {result['hasProseMirror']}")
        print(f"Has submit button: {result['hasSubmitButton']}")
        print(f"Button count: {result['buttonCount']}")
        print(f"ContentEditable count: {result['contentEditableCount']}")
        print(f"ContentEditable classes: {result['contentEditableClasses']}")
        print("\nInput elements found:")
        for elem in result["inputElements"]:
            print(f"  - {elem}")
        print(f"\nBody text preview: {result['bodyText'][:200]}...")

        # Take screenshot
        await page.screenshot(path="tests/assets/screenshots/grok_direct_check.png")
        print("\nScreenshot saved to tests/assets/screenshots/grok_direct_check.png")


if __name__ == "__main__":
    asyncio.run(test_grok_page())
