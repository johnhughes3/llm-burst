"""
Prompt injector for Google Gemini.

Selector sourced from Stage-0 patch selectors:
    textarea[aria-label='Enter your prompt']

Behaviour:
1. Wait for the textarea to appear.
2. Fill the text.
3. Send with ``Enter`` key.
"""
from playwright.async_api import Page, TimeoutError

from llm_burst.constants import LLMProvider
from . import register

_SELECTOR = "textarea[aria-label='Enter your prompt']"


@register(LLMProvider.GEMINI)
async def send_prompt(page: Page, text: str) -> None:
    await page.wait_for_selector(_SELECTOR, timeout=10_000)
    textarea = page.locator(_SELECTOR)
    await textarea.fill(text)
    # Hitting Enter submits the prompt for Gemini
    try:
        await textarea.press("Enter")
    except TimeoutError:
        # Fallback – click the send button if hotkey fails
        await page.locator("button[aria-label='Send']").click()