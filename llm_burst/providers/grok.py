"""
Prompt injector for xAI Grok.

Selector from Stage-0 macros:
    textarea[placeholder='Ask Grok anything...']
"""
from playwright.async_api import Page

from llm_burst.constants import LLMProvider
from . import register

_SELECTOR = "textarea[placeholder='Ask Grok anything...']"


@register(LLMProvider.GROK)
async def send_prompt(page: Page, text: str) -> None:
    await page.wait_for_selector(_SELECTOR, timeout=10_000)
    box = page.locator(_SELECTOR)
    await box.fill(text)
    await box.press("Enter")