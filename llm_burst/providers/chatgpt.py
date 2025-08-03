"""
Prompt injector for ChatGPT.

Selector mirrored from the original KM macro:
    textarea[data-id='root']

ChatGPT requires ⌘/Ctrl+Enter to avoid newline insertion.
"""
from playwright.async_api import Page

from llm_burst.constants import LLMProvider
from . import register

_SELECTOR = "textarea[data-id='root']"


@register(LLMProvider.CHATGPT)
async def send_prompt(page: Page, text: str) -> None:
    await page.wait_for_selector(_SELECTOR, timeout=10_000)
    box = page.locator(_SELECTOR)
    await box.fill(text)
    await box.press("Meta+Enter")          # macOS