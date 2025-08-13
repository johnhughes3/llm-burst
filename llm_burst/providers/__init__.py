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
import asyncio
import sys

from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

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
    use_paste: bool = False,
    wait_for_selector: str | None = None,
):
    """
    Build a coroutine that injects SUBMIT or FOLLOW-UP JavaScript into the page
    and invokes the correct entry-point, optionally using a paste-and-enter
    strategy after JS preparation.

    Placeholders accepted in the call templates:
        {prompt}     – JSON-encoded prompt text
        {research}   – "'Yes'" / "'No'"
        {incognito}  – "'Yes'" / "'No'"
    """

    async def _inject(page: Page, prompt: str, opts: "InjectOptions") -> None:  # noqa: D401
        # Wait for a critical selector if provided (robust readiness)
        if wait_for_selector:
            try:
                await page.wait_for_selector(wait_for_selector, timeout=15000)
            except PlaywrightTimeoutError:
                raise RuntimeError(f"Timeout waiting for selector: {wait_for_selector}")

        # Select script & template
        if opts.follow_up and followup_js and follow_tpl:
            js_src, call_tpl = followup_js, follow_tpl
        else:
            js_src, call_tpl = submit_js, submit_tpl

        if use_paste:
            await _paste_and_enter(page, prompt, opts, js_src, call_tpl)
        else:
            await _inject_js(page, prompt, opts, js_src, call_tpl)

    return _inject


async def _inject_js(
    page: Page, prompt: str, opts: "InjectOptions", js_src: str, call_tpl: str
) -> None:
    # Load helper functions (wrapped in IIFE to prevent conflicts)
    await page.evaluate(f"(function() {{ {js_src} }})()")

    # Build call expression
    call_expr = call_tpl.format(
        prompt=json.dumps(prompt),
        research="'Yes'" if opts.research else "'No'",
        incognito="'Yes'" if opts.incognito else "'No'",
    )

    # Execute with error reporting - return a result object
    result = await page.evaluate(
        f"""(async () => {{
                try {{
                    const r = await {call_expr};
                    return {{ success: true, result: r }};
                }} catch(e) {{
                    console.error('LLM injection error:', e);
                    return {{
                        success: false,
                        error: String(e),
                        stack: e.stack || 'No stack trace available'
                    }};
                }}
            }})()"""
    )

    if result and not result.get("success"):
        error_msg = result.get("error", "Unknown JavaScript error")
        stack = result.get("stack", "")
        raise RuntimeError(
            f"Provider JS injection failed: {error_msg}\nStack trace:\n{stack}"
        )


async def _paste_and_enter(
    page: Page, prompt: str, opts: "InjectOptions", js_src: str, call_tpl: str
) -> None:
    # Prepare the page via JS (e.g. focus editor, optional research)
    await _inject_js(page, prompt, opts, js_src, call_tpl)

    # Bring to front and paste prompt via system clipboard
    try:
        await page.bring_to_front()
    except Exception:
        pass

    try:
        import pyperclip  # local import to avoid hard dependency at import time

        pyperclip.copy(prompt)
    except Exception:
        # Fallback: type the prompt directly if clipboard fails
        await page.keyboard.insert_text(prompt)
    else:
        modifier = "Meta" if sys.platform == "darwin" else "Control"
        await page.keyboard.press(f"{modifier}+V")

    # Small delay then submit
    await asyncio.sleep(0.5)
    await page.keyboard.press("Enter")


def _build_chatgpt_injector(
    submit_js: str,
    followup_js: str | None,
    submit_tpl: str,
    follow_tpl: str | None,
    use_paste: bool,
    wait_for_selector: str | None,
):
    """
    Build a ChatGPT-specific injector that handles research mode navigation.
    """
    
    async def _chatgpt_inject(page: Page, prompt: str, opts: "InjectOptions") -> None:
        # Research Prompts GPT URL
        RESEARCH_URL = "https://chatgpt.com/g/g-p-68034199ee048191a6fe21d2dacdef09-research-prompts/project?model=gpt-5-pro"
        
        # If research mode is enabled and we're not on the Research Prompts page, navigate there
        if opts.research and not page.url.startswith("https://chatgpt.com/g/g-p-"):
            print(f"Research mode enabled. Navigating to Research Prompts GPT...")
            await page.goto(RESEARCH_URL, wait_until="load")
            
            # Wait for the page to be ready
            try:
                await page.wait_for_selector(
                    "#prompt-textarea, [data-testid='prompt-textarea'], .ProseMirror",
                    timeout=15000
                )
                # Additional wait for UI to stabilize
                await asyncio.sleep(1.0)
            except PlaywrightTimeoutError:
                raise RuntimeError("Timeout waiting for Research Prompts page to load")
        
        # Wait for critical selector if provided (robust readiness)
        if wait_for_selector:
            try:
                await page.wait_for_selector(wait_for_selector, timeout=15000)
            except PlaywrightTimeoutError:
                raise RuntimeError(f"Timeout waiting for selector: {wait_for_selector}")
        
        # Select script & template
        if opts.follow_up and followup_js and follow_tpl:
            js_src, call_tpl = followup_js, follow_tpl
        else:
            js_src, call_tpl = submit_js, submit_tpl
        
        if use_paste:
            await _paste_and_enter(page, prompt, opts, js_src, call_tpl)
        else:
            await _inject_js(page, prompt, opts, js_src, call_tpl)
    
    return _chatgpt_inject


# --------------------------------------------------------------------------- #
# Registry                                                                     #
# --------------------------------------------------------------------------- #

# Provider ➜ (SUBMIT_JS, FOLLOWUP_JS, submit_call_tpl, follow_call_tpl, use_paste, wait_for_selector)
ProviderConfig = tuple[str, str | None, str, str | None, bool, str | None]
_PROVIDER_CONFIG: dict[LLMProvider, ProviderConfig] = {
    LLMProvider.CHATGPT: (
        chatgpt.SUBMIT_JS,
        chatgpt.FOLLOWUP_JS,
        "automateOpenAIChat({prompt}, {research}, {incognito})",
        "chatGPTFollowUpMessage({prompt})",
        False,
        "#prompt-textarea, .ProseMirror",
    ),
    LLMProvider.GEMINI: (
        gemini.SUBMIT_JS,
        gemini.FOLLOWUP_JS,
        "automateGeminiChat({prompt}, {research})",
        "geminiFollowUpMessage({prompt})",
        False,
        ".ql-editor",
    ),
    LLMProvider.CLAUDE: (
        claude.SUBMIT_JS,
        claude.FOLLOWUP_JS,
        "automateClaudeInteraction({prompt}, {research})",
        "claudeFollowUpMessage({prompt})",
        False,
        ".ProseMirror",
    ),
    LLMProvider.GROK: (
        grok.SUBMIT_JS,
        grok.FOLLOWUP_JS,
        "automateGrokChat({prompt}, {research}, {incognito})",
        "grokFollowUpMessage({prompt})",
        False,
        'textarea[aria-label="Ask Grok anything"], [contenteditable="true"]',
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

    # Special handling for ChatGPT with research mode
    if provider == LLMProvider.CHATGPT:
        return _build_chatgpt_injector(*cfg)
    
    return _build_injector(*cfg)
