"""
Prompt injector for Anthropic Claude.

Exact selector from Stage-0 macros:
    textarea[data-testid='composerTextarea']

If the selector ever changes, update here *and* in the tests.
"""
from playwright.async_api import Page

from llm_burst.constants import LLMProvider
from . import register

_SELECTOR = "textarea[data-testid='composerTextarea']"


@register(LLMProvider.CLAUDE)
async def send_prompt(page: Page, text: str) -> None:
    await page.wait_for_selector(_SELECTOR, timeout=10_000)
    box = page.locator(_SELECTOR)
    await box.fill(text)
    await box.press("Enter")