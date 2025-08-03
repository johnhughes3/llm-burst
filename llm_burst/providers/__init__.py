"""
llm_burst.providers
-------------------

Registry and helpers for provider-specific "prompt injection" routines.

Each provider module MUST define an ``async def send_prompt(page: Page, text: str)``.
The decorator ``@register(LLMProvider.X)`` adds the implementation to the registry
so callers can simply do:

    injector = get_injector(LLMProvider.GEMINI)
    await injector(page, "Hello!")

Adding a new provider is therefore as easy as dropping a ``foo.py`` module that
calls ``@register(LLMProvider.FOO)``.
"""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Dict

from playwright.async_api import Page

from llm_burst.constants import LLMProvider

__all__ = [
    "register",
    "get_injector",
]

_Registry: Dict[LLMProvider, Callable[[Page, str], Awaitable[None]]] = {}


def register(provider: LLMProvider):
    """
    Decorator for registering a provider-specific ``send_prompt`` coroutine.
    """
    def _decorator(func: Callable[[Page, str], Awaitable[None]]):
        _Registry[provider] = func
        return func
    return _decorator


def get_injector(provider: LLMProvider) -> Callable[[Page, str], Awaitable[None]]:
    """
    Return the injection coroutine for *provider*.
    """
    # Import all provider modules to register them
    from . import gemini, claude, chatgpt, grok  # noqa: F401
    
    try:
        return _Registry[provider]
    except KeyError:                       # pragma: no cover
        raise RuntimeError(f"No injector registered for provider: {provider}")