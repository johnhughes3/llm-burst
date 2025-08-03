"""
llm_burst.providers
-------------------

Map each LLMProvider → coroutine that drops the provider's SUBMIT_JS into the
page and invokes the entry-point function defined in that script.

The goal is not to cover every edge-case but to provide a dependable baseline
for both *activate* and *follow-up* commands.
"""

from __future__ import annotations
import json
import textwrap
from typing import Awaitable, Callable, Dict

from playwright.async_api import Page

from .constants import LLMProvider
from .sites import chatgpt, claude, gemini, grok

# --------------------------------------------------------------------------- #
# Helper to build an injector                                                 #
# --------------------------------------------------------------------------- #

def _build_injector(submit_js: str, function_call_template: str) -> Callable[[Page, str], Awaitable[None]]:
    """
    Return an async injector that evaluates *submit_js* in the page then calls
    *function_call_template* with the JSON-encoded prompt.

    *function_call_template* must contain exactly one placeholder ``{prompt}``
    which will be replaced by the JS literal of the prompt.
    """

    async def _inject(page: Page, prompt: str) -> None:
        await page.evaluate(submit_js)
        call_expr = function_call_template.format(prompt=json.dumps(prompt))
        # Ensure call happens within an async IIFE to await internal promises
        await page.evaluate(f"""(async () => {{ try {{ await {call_expr}; }} catch(e) {{ console.error(e); }} }})()""")

    return _inject

# --------------------------------------------------------------------------- #
# Registry                                                                     #
# --------------------------------------------------------------------------- #

_INJECTORS: Dict[LLMProvider, Callable[[Page, str], Awaitable[None]]] = {
    LLMProvider.CHATGPT: _build_injector(
        chatgpt.SUBMIT_JS,
        "automateOpenAIChat({prompt}, 'No', 'No')",
    ),
    LLMProvider.GEMINI: _build_injector(
        gemini.SUBMIT_JS,
        "automateGeminiChat({prompt}, 'No')",
    ),
    LLMProvider.CLAUDE: _build_injector(
        claude.SUBMIT_JS,
        # Claude's SUBMIT_JS focuses editor – we paste text via JS afterwards
        "(function(txt) {{ document.execCommand('insertText', false, txt); }})({prompt})",
    ),
    LLMProvider.GROK: _build_injector(
        grok.SUBMIT_JS,
        "automateGrokChat({prompt}, 'No', 'No')",
    ),
}

def get_injector(provider: LLMProvider):
    """
    Return the coroutine injector for *provider*.

    Raises
    ------
    KeyError
        If the provider is unknown / not registered.
    """
    return _INJECTORS[provider]