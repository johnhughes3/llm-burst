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
from dataclasses import dataclass

from playwright.async_api import Page

from llm_burst.constants import LLMProvider
from llm_burst.sites import chatgpt, claude, gemini, grok

__all__ = [
    "InjectOptions",
    "get_injector",
]


@dataclass(slots=True)
class InjectOptions:
    """Control flags passed to the JS injector."""

    follow_up: bool = False
    research: bool = False
    incognito: bool = False


# --------------------------------------------------------------------------- #
# Helper to build an injector                                                 #
# --------------------------------------------------------------------------- #


def _build_injector(
    submit_js: str,
    followup_js: str | None,
    submit_tpl: str,
    follow_tpl: str | None,
):
    """
    Build a coroutine that injects SUBMIT or FOLLOW-UP JavaScript into the page
    and invokes the correct entry-point.

    Placeholders accepted in the call templates:
        {prompt}     – JSON-encoded prompt text
        {research}   – \"'Yes'\" / \"'No'\"
        {incognito}  – \"'Yes'\" / \"'No'\"
    """

    async def _inject(page: Page, prompt: str, opts: "InjectOptions") -> None:  # noqa: D401
        # Select script & template
        if opts.follow_up and followup_js and follow_tpl:
            js_src, call_tpl = followup_js, follow_tpl
        else:
            js_src, call_tpl = submit_js, submit_tpl

        # Load helper functions
        await page.evaluate(js_src)

        # Build call expression
        call_expr = call_tpl.format(
            prompt=json.dumps(prompt),
            research="'Yes'" if opts.research else "'No'",
            incognito="'Yes'" if opts.incognito else "'No'",
        )

        # Execute inside async IIFE to await any internal promises
        await page.evaluate(
            f"(async () => {{ try {{ await {call_expr}; }} catch(e) {{ console.error(e); }} }})()"
        )

    return _inject


# --------------------------------------------------------------------------- #
# Registry                                                                     #
# --------------------------------------------------------------------------- #

# Provider ➜ (SUBMIT_JS, FOLLOWUP_JS, submit_call_tpl, follow_call_tpl)
_PROVIDER_CONFIG: dict[LLMProvider, tuple[str, str | None, str, str | None]] = {
    LLMProvider.CHATGPT: (
        chatgpt.SUBMIT_JS,
        chatgpt.FOLLOWUP_JS,
        "automateOpenAIChat({prompt}, {research}, {incognito})",
        "chatGPTFollowUpMessage({prompt})",
    ),
    LLMProvider.GEMINI: (
        gemini.SUBMIT_JS,
        gemini.FOLLOWUP_JS,
        "automateGeminiChat({prompt}, {research})",
        "geminiFollowUpMessage({prompt})",
    ),
    LLMProvider.CLAUDE: (
        claude.SUBMIT_JS,
        claude.FOLLOWUP_JS,
        "automateClaudeInteraction({research})",
        "claudeFollowUpMessage({prompt})",
    ),
    LLMProvider.GROK: (
        grok.SUBMIT_JS,
        grok.FOLLOWUP_JS,
        "automateGrokChat({prompt}, {research}, {incognito})",
        "grokFollowUpMessage({prompt})",
    ),
}


def get_injector(provider: LLMProvider):
    """
    Return an injector coroutine for *provider*.

    Usage:
        opts = InjectOptions(...)
        injector = get_injector(provider)
        await injector(page, prompt, opts)
    """
    try:
        cfg = _PROVIDER_CONFIG[provider]
    except KeyError as exc:
        raise KeyError(f"Unknown provider: {provider}") from exc
    
    base_injector = _build_injector(*cfg)
    
    # Special behaviour for Claude: after JS focuses the editor, paste + send.
    if provider is LLMProvider.CLAUDE:
        
        async def _claude_inject(page: Page, prompt: str, opts: "InjectOptions") -> None:  # noqa: D401
            await base_injector(page, prompt, opts)
            
            # Only for initial submission – follow-ups already handled in JS
            if not opts.follow_up:
                try:
                    import pyperclip
                    pyperclip.copy(prompt)
                except Exception:
                    # Non-fatal – continue without clipboard
                    pass
                
                # Give the browser a brief moment to settle focus
                await page.wait_for_timeout(100)
                await page.keyboard.press("Meta+V")
                await page.keyboard.press("Enter")
        
        return _claude_inject
    
    return base_injector
