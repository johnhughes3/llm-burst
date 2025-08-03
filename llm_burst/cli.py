"""
llm_burst.cli
-------------

CLI helpers and entry points for the llm-burst tool.

Stage-1: expose a prompt_user() function that launches the swiftDialog wrapper
and returns the user's selections as a Python dict.  Later stages will build a
Click-based interface on top of this helper.

Stage-2: add async bridge functions to enable synchronous CLI code to interact
with the asynchronous BrowserAdapter.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from typing import Any, Dict, Union, Optional
import logging
from uuid import uuid4

from .constants import (
    SWIFT_PROMPT_SCRIPT,
    PROMPT_OK_EXIT,
    PROMPT_CANCEL_EXIT,
    LLMProvider,
)
from .browser import BrowserAdapter, SessionHandle
from .providers import get_injector


def prompt_user() -> Dict[str, Any]:
    """
    Launch the swiftDialog prompt wrapper and return the user's input.

    Returns
    -------
    dict
        The JSON data produced by swiftDialog, parsed into a dictionary.

    Side Effects
    ------------
    " If the user cancels (non-zero exit code) the current process terminates
      with PROMPT_CANCEL_EXIT.
    " Any stderr emitted by the shell script is forwarded to this program's
      stderr to aid debugging.
    """
    result = subprocess.run(
        [str(SWIFT_PROMPT_SCRIPT)],
        capture_output=True,
        text=True,
    )

    # Forward any error output to the calling terminal.
    if result.stderr:
        sys.stderr.write(result.stderr)

    if result.returncode != PROMPT_OK_EXIT:
        # User cancelled or an error occurred inside the shell script.
        sys.exit(PROMPT_CANCEL_EXIT)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        # Malformed JSON is treated as an error / cancel.
        sys.stderr.write(f"Failed to parse JSON from swiftDialog: {exc}\n")
        sys.exit(PROMPT_CANCEL_EXIT)


# --------------------------------------------------------------------------- #
# Stage-2: Async bridge functions                                             #
# --------------------------------------------------------------------------- #

def _generate_placeholder(provider: LLMProvider) -> str:
    """Generate a placeholder task name like 'PROVIDER-1a2b'."""
    return f"{provider.name}-{uuid4().hex[:4]}"


def open_llm_window(task_name: str, provider: LLMProvider) -> SessionHandle:
    """
    Synchronous wrapper to open an LLM browser window.

    *task_name* may be ``None`` – in that case a placeholder of the form
    ``PROVIDER-xxxx`` is generated and later eligible for auto-naming.
    """
    # Generate placeholder if caller supplied no explicit name
    if task_name is None:                       # type: ignore[arg-type]
        task_name = _generate_placeholder(provider)

    return asyncio.run(_async_open_window(task_name, provider))


async def _async_open_window(task_name: str, provider: LLMProvider) -> SessionHandle:
    """Internal async implementation for open_llm_window."""
    async with BrowserAdapter() as adapter:
        return await adapter.open_window(task_name, provider)


def send_prompt_sync(handle_or_task: Union[SessionHandle, str], prompt: str) -> None:
    """
    Synchronous bridge that injects *prompt* into an existing session.

    Parameters
    ----------
    handle_or_task : SessionHandle | str
        Either a previously returned SessionHandle or a task name.
    prompt : str
        Text to send to the provider's chat box.
    """
    asyncio.run(_async_send_prompt(handle_or_task, prompt))


async def _async_send_prompt(handle_or_task: Union[SessionHandle, str], prompt: str) -> None:
    from .state import StateManager
    from .browser import BrowserAdapter

    # Resolve provider + page
    if isinstance(handle_or_task, SessionHandle):
        provider = handle_or_task.live.provider
        page = handle_or_task.page
    else:
        task_name = handle_or_task
        state = StateManager()
        session = state.get(task_name)
        if session is None:
            raise RuntimeError(f"No live session found for task '{task_name}'")

        async with BrowserAdapter() as adapter:
            page = await adapter._find_page_for_target(session.target_id)
            if page is None:
                raise RuntimeError(f"Could not locate page for task '{task_name}'")
            provider = session.provider

    injector = get_injector(provider)
    await injector(page, prompt)


def get_running_sessions() -> Dict[str, Any]:
    """
    Retrieve all currently tracked browser sessions.
    
    Returns
    -------
    dict
        Mapping of task_name to session metadata (provider, target_id, window_id).
    
    Example
    -------
    >>> from llm_burst.cli import get_running_sessions
    >>> sessions = get_running_sessions()
    >>> for task, info in sessions.items():
    ...     print(f"{task}: {info['provider']}")
    """
    from .state import StateManager
    
    state = StateManager()
    sessions = state.list_all()
    
    return {
        task_name: {
            "provider": session.provider.name,
            "target_id": session.target_id,
            "window_id": session.window_id,
        }
        for task_name, session in sessions.items()
    }


def close_llm_window_sync(task_name: str) -> bool:
    """
    Close and unregister the browser window for *task_name*.

    Returns True if a window was found and closed.
    """
    return asyncio.run(_async_close_window(task_name))


async def _async_close_window(task_name: str) -> bool:
    from .browser import BrowserAdapter

    async with BrowserAdapter() as adapter:
        return await adapter.close_window(task_name)


def auto_name_sync(handle: SessionHandle) -> Optional[str]:
    """
    Invoke the asynchronous auto-naming routine for *handle* and wait for
    completion.

    Returns
    -------
    str | None
        The new task name when a rename occurred, otherwise ``None``.
    """
    from .auto_namer import auto_name_session

    return asyncio.run(auto_name_session(handle.live, handle.page))