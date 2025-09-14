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
from dotenv import load_dotenv, find_dotenv

from .constants import (
    LLMProvider,
    GEMINI_MODEL_NAME,
    GEMINI_API_KEY_ENV,
    AUTO_NAMING_MAX_CHARS,
    AUTO_NAMING_TIMEOUT,
    PACKAGE_ROOT,
)
from .state import LiveSession, StateManager
from .browser import set_window_title

_LOG = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Environment Setup (Load .env)
# --------------------------------------------------------------------------- #

"""
Robust .env loading strategy:
1) Honour explicit LLM_BURST_DOTENV if set.
2) Load PACKAGE_ROOT/.env when present (repo layout in dev).
3) Use dotenv discovery from current working directory upwards.
This allows running the package from anywhere while keeping dev ergonomics.
"""
try:
    # 1) Explicit override via env var
    specific = os.environ.get("LLM_BURST_DOTENV")
    if specific and os.path.exists(specific):
        load_dotenv(specific)
        _LOG.debug("Loaded .env from LLM_BURST_DOTENV: %s", specific)
    else:
        # 2) Repo root (when running from source checkout)
        env_path = PACKAGE_ROOT / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            _LOG.debug("Loaded .env from project root: %s", env_path)
        else:
            # 3) Discover relative to CWD
            discovered = find_dotenv(usecwd=True)
            if discovered:
                load_dotenv(discovered)
                _LOG.debug("Loaded .env via discovery: %s", discovered)
            else:
                # Fallback to default behaviour (CWD only)
                if load_dotenv():
                    _LOG.debug("Loaded .env from CWD.")
                else:
                    _LOG.debug(
                        "No .env found (checked explicit, repo, discovery, CWD)."
                    )
except Exception as e:
    _LOG.warning("Failed to load .env file: %s", e)


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
    """Configure Gemini API and return model instance.

    Tries the configured model first, then falls back to stable models if
    unavailable. Returns None if the API key is missing or model creation fails.
    """
    # Re-check after our .env loading to ensure env is seeded
    api_key = os.getenv(GEMINI_API_KEY_ENV)
    if not api_key:
        _LOG.warning(
            "No Gemini API key found in %s - auto-naming disabled", GEMINI_API_KEY_ENV
        )
        return None

    genai.configure(api_key=api_key)

    # Configure for structured JSON output
    generation_config_json = {
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

    # Try configured model, then fall back to stable flashes if needed
    candidates = [
        GEMINI_MODEL_NAME,
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
    ]

    last_err: Exception | None = None
    for name in candidates:
        try:
            model = genai.GenerativeModel(
                model_name=name,
                generation_config=generation_config_json,
                safety_settings=safety_settings,
            )
            _LOG.info("Gemini auto-naming using model: %s", name)
            return model
        except Exception as e:
            last_err = e
            _LOG.debug("Gemini model '%s' failed: %s", name, e)

    _LOG.warning("Gemini model creation failed: %s", last_err)
    return None


# --------------------------------------------------------------------------- #
# Conversation Extraction
# --------------------------------------------------------------------------- #


async def extract_conversation(
    page: Page, provider: LLMProvider, max_chars: int = AUTO_NAMING_MAX_CHARS
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
        # Wait for at least one user message (best-effort)
        try:
            await page.wait_for_selector(selectors["user"], timeout=3000)
        except Exception:
            # Continue even if this wait fails; we'll try a fallback later
            pass

        messages = []

        # Get user messages
        try:
            user_elements = await page.query_selector_all(selectors["user"])
            for elem in user_elements:
                text = await elem.inner_text()
                if text:
                    messages.append(("user", text.strip()))
        except Exception:
            pass

        # Get assistant messages if present
        try:
            assistant_elements = await page.query_selector_all(selectors["assistant"])
            for elem in assistant_elements:
                text = await elem.inner_text()
                if text:
                    messages.append(("assistant", text.strip()))
        except Exception:
            pass

        # Build conversation text in DOM order (already pushed in appearance order)
        conversation = []
        for role, text in messages:
            if role == "user":
                conversation.append(f"User: {text}")
            else:
                conversation.append(f"Assistant: {text}")

        full_text = "\n\n".join(conversation).strip()

        # Fallback when selectors fail or produce no content: take body text
        if not full_text:
            try:
                body_text = (await page.inner_text("body")).strip()
            except Exception:
                body_text = ""
            if body_text:
                # Keep first and last halves if too long
                if len(body_text) > max_chars:
                    half_limit = (max_chars - 10) // 2
                    full_text = (
                        body_text[:half_limit] + "\n\n...\n\n" + body_text[-half_limit:]
                    )
                else:
                    full_text = body_text

        if not full_text:
            return None

        # Clamp overly long conversations: take head & tail
        if len(full_text) > max_chars:
            half_limit = (max_chars - 10) // 2  # Reserve 10 chars for separator
            first_part = full_text[:half_limit]
            last_part = full_text[-half_limit:]
            full_text = first_part + "\n\n...\n\n" + last_part

        return full_text

    except Exception as e:
        _LOG.debug("Failed to extract conversation: %s", e)
        return None


# --------------------------------------------------------------------------- #
# Name Generation
# --------------------------------------------------------------------------- #


async def generate_task_name(
    conversation: str, model: genai.GenerativeModel
) -> Optional[str]:
    """
    Generate a task name from conversation context using Gemini API.

    Returns the generated name or None if generation fails.
    """
    prompt = textwrap.dedent("""
        Name this conversation for a browser tab group.
        
        Guidelines:
        - Aim for 1–3 words (ideally two); go longer only if needed to clearly disambiguate from similar topics.
        - Use Title Case. No emojis, brackets, quotes, code fences, or trailing punctuation.
        - Include a concrete qualifier when helpful (e.g., product, jurisdiction, framework, year).
        - Avoid generic labels (Chat, Notes, Draft, Brainstorm). Prefer something memorable yet compact (≈ ≤ 24 chars when reasonable).
        
        Return a JSON object with exactly one field: task_name, whose value is the title string only.
        
        Conversation:
        {conversation}
    """).format(conversation=conversation)

    try:
        response = await asyncio.to_thread(model.generate_content, prompt)

        # Robustly extract text from response - handling various API response formats
        raw_text = None

        # Method 1: Direct text attribute
        if hasattr(response, "text") and response.text:
            raw_text = response.text

        # Method 2: Via candidates structure (newer API versions)
        if not raw_text and hasattr(response, "candidates") and response.candidates:
            try:
                # Navigate the nested structure safely
                for candidate in response.candidates:
                    if hasattr(candidate, "content") and candidate.content:
                        content = candidate.content
                        if hasattr(content, "parts") and content.parts:
                            for part in content.parts:
                                if hasattr(part, "text") and part.text:
                                    raw_text = part.text
                                    break
                    if raw_text:
                        break
            except Exception as e:
                _LOG.debug(f"Failed to extract from candidates: {e}")

        # Method 3: Try to extract via dict access (some API versions)
        if not raw_text:
            try:
                if hasattr(response, "_result") and response._result:
                    if "candidates" in response._result:
                        candidates = response._result["candidates"]
                        if candidates and len(candidates) > 0:
                            content = candidates[0].get("content", {})
                            parts = content.get("parts", [])
                            if parts and len(parts) > 0:
                                raw_text = parts[0].get("text", "")
            except Exception:
                pass

        if not raw_text:
            # Try 'parsed' attribute if structured outputs are enabled
            if hasattr(response, "parsed") and response.parsed:
                try:
                    # Some library versions return parsed Pydantic-like objects or dicts
                    parsed = response.parsed
                    if isinstance(parsed, dict) and "task_name" in parsed:
                        name = parsed.get("task_name")
                        if isinstance(name, str) and name.strip():
                            return name.strip()
                except Exception:
                    pass

        if not raw_text:
            _LOG.warning("Could not extract text from Gemini response")
            return None

        # Handle various response formats (markdown, JSON with code fences, etc.)
        if raw_text.strip().startswith("```"):
            # Remove markdown code fences
            import re

            cleaned = raw_text.strip()
            # Match ```json or just ```
            cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)
            raw_text = cleaned.strip()

        # Parse the response
        if raw_text:
            # Method 1: Try structured Pydantic validation
            try:
                task_obj = TaskName.model_validate_json(raw_text)
                return task_obj.task_name
            except Exception as e:
                _LOG.debug(f"Pydantic validation failed: {e}")

            # Method 2: Try basic JSON parsing
            try:
                import json

                data = json.loads(raw_text)
                if isinstance(data, dict) and "task_name" in data:
                    name = data["task_name"]
                    if isinstance(name, str) and len(name.strip()) >= 3:
                        return name.strip()
            except json.JSONDecodeError as e:
                _LOG.debug(f"JSON parsing failed: {e}")

            # Method 3: Extract from plain text response
            try:
                # If it's just a plain string, use it directly
                lines = raw_text.strip().splitlines()
                if lines:
                    # Take first non-empty line, remove quotes
                    first_line = lines[0].strip().strip("\"'")
                    if len(first_line) >= 3 and len(first_line) <= 80:
                        return first_line
            except Exception:
                pass

    except Exception as e:
        _LOG.warning("Gemini API error: %s", e)

    return None


# --------------------------------------------------------------------------- #
# Main Auto-naming Function
# --------------------------------------------------------------------------- #


async def auto_name_session(session: LiveSession, page: Page) -> Optional[str]:
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
        _LOG.debug(
            "Skipping auto-naming for '%s' - not a placeholder", session.task_name
        )
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
                _LOG.info(
                    "Auto-named session: '%s' -> '%s'", session.task_name, new_name
                )

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
            suffix = name[len(provider) + 1 :]
            # Check if suffix is numeric or hex-like
            if suffix.isdigit() or all(c in "0123456789abcdef" for c in suffix.lower()):
                return True
    return False


async def suggest_task_name(page: Page, provider: LLMProvider) -> Optional[str]:
    """Return a suggested session title derived from the current conversation without mutating any state."""
    model = _setup_gemini()
    if not model:
        return None

    conversation = await extract_conversation(page, provider)
    if not conversation:
        return None

    return await generate_task_name(conversation, model)


async def suggest_session_name(
    page: Page, provider: LLMProvider, timeout: float = AUTO_NAMING_TIMEOUT
) -> Optional[str]:
    """
    Extract conversation and suggest a name using Gemini API, without mutating state.

    This is an alias for suggest_task_name with optional timeout support.
    Returns the suggested name or None if generation fails or API is not configured.
    """
    try:
        async with asyncio.timeout(timeout):
            return await suggest_task_name(page, provider)
    except asyncio.TimeoutError:
        _LOG.warning("Name suggestion timed out after %s seconds", timeout)
        return None
    except Exception as e:
        _LOG.warning("Name suggestion failed: %s", e)
        return None
