"""
llm_burst.auto_namer
--------------------

Stage-4: Auto-naming functionality using Gemini API.

This module uses the Gemini API to intelligently generate task names from
conversation context, replacing placeholder names with meaningful descriptions.
"""

from __future__ import annotations

import asyncio
import logging
import os
import textwrap
from typing import Optional

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from playwright.async_api import Page
from pydantic import BaseModel, ConfigDict

from .constants import (
    LLMProvider,
    GEMINI_MODEL_NAME,
    GEMINI_API_KEY_ENV,
    AUTO_NAMING_MAX_CHARS,
    AUTO_NAMING_TIMEOUT,
)
from .state import LiveSession, StateManager

_LOG = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Pydantic Model for Structured Output
# --------------------------------------------------------------------------- #

class TaskName(BaseModel):
    """Structured output schema for Gemini response."""
    task_name: str
    model_config = ConfigDict(str_strip_whitespace=True)


# --------------------------------------------------------------------------- #
# Provider-specific selectors for extracting conversation
# --------------------------------------------------------------------------- #

_CONVERSATION_SELECTORS: dict[LLMProvider, dict[str, str]] = {
    LLMProvider.GEMINI: {
        "user": "div[data-message-author='user'] .message-content",
        "assistant": "div[data-message-author='assistant'] .message-content",
    },
    LLMProvider.CLAUDE: {
        "user": "div[data-testid='user-message']",
        "assistant": "div[data-testid='assistant-message']",
    },
    LLMProvider.CHATGPT: {
        "user": "div[data-message-author-role='user']",
        "assistant": "div[data-message-author-role='assistant']",
    },
    LLMProvider.GROK: {
        "user": "div.chat-message.user",
        "assistant": "div.chat-message.assistant",
    },
}


# --------------------------------------------------------------------------- #
# Gemini API Client Setup
# --------------------------------------------------------------------------- #

def _setup_gemini() -> Optional[genai.GenerativeModel]:
    """Configure Gemini API and return model instance."""
    api_key = os.getenv(GEMINI_API_KEY_ENV)
    if not api_key:
        _LOG.warning("No Gemini API key found in %s - auto-naming disabled", GEMINI_API_KEY_ENV)
        return None
    
    genai.configure(api_key=api_key)
    
    # Configure for structured JSON output
    generation_config = {
        "temperature": 0.5,
        "top_p": 0.95,
        "top_k": 40,
        "max_output_tokens": 256,
        "response_mime_type": "application/json",
        "response_schema": TaskName.model_json_schema(),
    }
    
    # Relaxed safety settings for naming task
    safety_settings = {
        HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
        HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
    }
    
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL_NAME,
        generation_config=generation_config,
        safety_settings=safety_settings,
    )


# --------------------------------------------------------------------------- #
# Conversation Extraction
# --------------------------------------------------------------------------- #

async def extract_conversation(
    page: Page,
    provider: LLMProvider,
    max_chars: int = AUTO_NAMING_MAX_CHARS
) -> Optional[str]:
    """
    Extract conversation content from the LLM page.
    
    Returns formatted conversation text or None if extraction fails.
    """
    selectors = _CONVERSATION_SELECTORS.get(provider)
    if not selectors:
        _LOG.warning("No conversation selectors configured for %s", provider)
        return None
    
    try:
        # Wait for at least one user message
        await page.wait_for_selector(selectors["user"], timeout=3000)
        
        # Extract all messages
        messages = []
        
        # Get user messages
        user_elements = await page.query_selector_all(selectors["user"])
        for elem in user_elements:
            text = await elem.inner_text()
            if text:
                messages.append(("user", text.strip()))
        
        # Get assistant messages if present
        assistant_elements = await page.query_selector_all(selectors["assistant"])
        for elem in assistant_elements:
            text = await elem.inner_text()
            if text:
                messages.append(("assistant", text.strip()))
        
        # Sort by appearance order (assuming DOM order)
        # Build conversation text
        conversation = []
        for role, text in messages:
            if role == "user":
                conversation.append(f"User: {text}")
            else:
                conversation.append(f"Assistant: {text}")
        
        full_text = "\n\n".join(conversation)
        
        # Truncate to max_chars from the end (most recent context)
        # This keeps the latest messages which are most relevant for naming
        if len(full_text) > max_chars:
            # Keep the last max_chars characters, add "..." to indicate truncation
            full_text = "..." + full_text[-(max_chars - 3):]
        
        return full_text
    
    except Exception as e:
        _LOG.debug("Failed to extract conversation: %s", e)
        return None


# --------------------------------------------------------------------------- #
# Name Generation
# --------------------------------------------------------------------------- #

async def generate_task_name(
    conversation: str,
    model: genai.GenerativeModel
) -> Optional[str]:
    """
    Generate a task name from conversation context using Gemini API.
    
    Returns the generated name or None if generation fails.
    """
    prompt = textwrap.dedent("""
        You are a task naming assistant. Based on the conversation below,
        generate a concise, descriptive task name (3-6 words) that captures
        the main topic or purpose of the discussion.
        
        Requirements:
        - Use title case (e.g., "Quantum Computing Research")
        - Be specific but concise
        - Focus on the main topic or goal
        - Avoid generic names like "Chat" or "Conversation"
        
        Return a JSON object with exactly one field: task_name
        
        Conversation:
        {conversation}
    """).format(conversation=conversation)
    
    try:
        response = await asyncio.to_thread(
            model.generate_content,
            prompt
        )
        
        # Parse the JSON response
        if response.text:
            task_obj = TaskName.model_validate_json(response.text)
            return task_obj.task_name
        
    except Exception as e:
        _LOG.warning("Gemini API error: %s", e)
    
    return None


# --------------------------------------------------------------------------- #
# Main Auto-naming Function
# --------------------------------------------------------------------------- #

async def auto_name_session(
    session: LiveSession,
    page: Page
) -> Optional[str]:
    """
    Automatically generate and apply a name for the session.
    
    Returns the new name if successful, None otherwise.
    """
    # Skip if API not configured
    model = _setup_gemini()
    if not model:
        return None
    
    # Skip if not a placeholder name (already has meaningful name)
    if not _is_placeholder_name(session.task_name):
        _LOG.debug("Skipping auto-naming for '%s' - not a placeholder", session.task_name)
        return None
    
    try:
        # Set overall timeout
        async with asyncio.timeout(AUTO_NAMING_TIMEOUT):
            # Extract conversation
            conversation = await extract_conversation(page, session.provider)
            if not conversation:
                _LOG.debug("No conversation content to generate name from")
                return None
            
            # Generate name
            new_name = await generate_task_name(conversation, model)
            if not new_name or len(new_name) < 3:
                _LOG.debug("Generated name too short or empty: %s", new_name)
                return None
            
            # Apply rename
            state = StateManager()
            renamed = state.rename(session.task_name, new_name)
            if renamed:
                _LOG.info("Auto-named session: '%s' -> '%s'", session.task_name, new_name)
                
                # Update browser window title
                await set_window_title(page, new_name)
                
                # Update session object for caller
                session.task_name = new_name
                return new_name
            else:
                _LOG.warning("Failed to rename - name collision or session not found")
    
    except asyncio.TimeoutError:
        _LOG.warning("Auto-naming timed out after %s seconds", AUTO_NAMING_TIMEOUT)
    except Exception as e:
        _LOG.warning("Auto-naming failed: %s", e)
    
    return None


# --------------------------------------------------------------------------- #
# Helper Functions
# --------------------------------------------------------------------------- #

def _is_placeholder_name(name: str) -> bool:
    """Check if the name looks like an auto-generated placeholder."""
    # Patterns: Provider-xxxx, Provider-1, etc.
    providers = ["GEMINI", "CLAUDE", "CHATGPT", "GROK"]
    for provider in providers:
        if name.upper().startswith(provider + "-"):
            suffix = name[len(provider) + 1:]
            # Check if suffix is numeric or hex-like
            if suffix.isdigit() or all(c in "0123456789abcdef" for c in suffix.lower()):
                return True
    return False


async def set_window_title(page: Page, title: str) -> None:
    """Update the browser window/tab title."""
    try:
        await page.evaluate(f"document.title = {repr(title)}")
    except Exception as e:
        _LOG.debug("Failed to set window title: %s", e)