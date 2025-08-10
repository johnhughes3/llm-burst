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
import os
import subprocess
import sys
import pyperclip
from typing import Any, Dict, Union, Optional
from uuid import uuid4

from .constants import (
    SWIFT_PROMPT_SCRIPT,
    PROMPT_OK_EXIT,
    PROMPT_CANCEL_EXIT,
    LLMProvider,
)
from .browser import BrowserAdapter, SessionHandle


def prompt_user() -> Dict[str, Any]:
    """
    Launch the swiftDialog prompt and return the user's input.

    Returns
    -------
    dict
        The JSON data produced by swiftDialog, parsed into a dictionary.

    Side Effects
    ------------
    - If the user cancels (non-zero exit code) the current process terminates
      with PROMPT_CANCEL_EXIT.
    - Any stderr emitted by the shell script is forwarded to this program's
      stderr to aid debugging.

    Raises
    ------
    FileNotFoundError
        If swiftDialog is not installed.
    """
    # Honour explicit opt-out: skip dialog entirely when requested
    no_dialog = os.getenv("LLM_BURST_NO_DIALOG", "").lower() in {"1", "true", "yes"}
    if no_dialog:
        try:
            clipboard_text: str = pyperclip.paste()
        except Exception:
            clipboard_text = ""
        if clipboard_text:
            return {
                "Prompt Text": clipboard_text,
                "Research mode": False,
                "Incognito mode": False,
            }
        # Nothing sensible to return – behave like cancel/missing dialog
        return {}

    # Check if dialog binary exists first
    import shutil
    import tempfile
    if not shutil.which("dialog"):
        try:
            clipboard_text: str = pyperclip.paste()
            if clipboard_text:
                print("Using clipboard content as fallback (swiftDialog not available)", file=sys.stderr)
                return {
                    "Prompt Text": clipboard_text,
                    "Research mode": False,
                    "Incognito mode": False
                }
        except Exception:
            pass
        return {}

    # Grab clipboard to pre-seed the dialog (falls back silently)
    try:
        clipboard_text: str = pyperclip.paste()
    except Exception:
        clipboard_text = ""

    dialog_config = {
      "title": "Start LLM Burst",
      "width": 600,
      "height": 420,
      "message": "Please confirm your prompt from clipboard:\n\n**Keyboard shortcuts:** Press ⌘↩ (Cmd+Return) to submit",
      "messagefont": "size=14",
      "textfield": [
        {
          "title": "Prompt Text",
          "editor": True,
          "required": True,
          "value": clipboard_text
        }
      ],
      "checkbox": [
        {"label": "Research mode", "checked": False},
        {"label": "Incognito mode", "checked": False}
      ],
      "button1text": "OK",
      "button1action": "return",
      "button2text": "Cancel",
      "hidetimerbar": True,
      "moveable": True
    }

    # Create temp config file with proper cleanup
    tmp_config_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json") as tmp_config:
            json.dump(dialog_config, tmp_config)
            tmp_config_path = tmp_config.name

        # Call dialog CLI directly - no wrapper, no Finder involvement
        result = subprocess.run(
            ["dialog", "--jsonfile", tmp_config_path, "--json"],
            capture_output=True,
            text=True,
        )
    finally:
        # Always clean up temp file, even if subprocess fails
        if tmp_config_path and os.path.exists(tmp_config_path):
            try:
                os.unlink(tmp_config_path)
            except Exception:
                pass

    # Only log meaningful errors, not the Finder -50 or safe-wrapper fallback notice
    if (
        result.stderr
        and "-50" not in result.stderr
        and "application can't be opened" not in result.stderr
        and "SwiftDialog error detected" not in result.stderr
    ):
        sys.stderr.write(result.stderr)

    if result.returncode != PROMPT_OK_EXIT:
        # User cancelled or an error occurred.
        sys.exit(PROMPT_CANCEL_EXIT)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        # Malformed JSON is treated as an error / cancel.
        sys.stderr.write(f"Failed to parse JSON from swiftDialog: {exc}\n")
        sys.stderr.write(f"Raw output was: {repr(result.stdout)}\n")
        sys.exit(PROMPT_CANCEL_EXIT)


def prune_stale_sessions_sync() -> int:
    """Synchronous wrapper to prune stale sessions."""
    # Ensure Chrome is ready (idempotent)
    from llm_burst.chrome_bootstrap import ensure_remote_debugging
    ensure_remote_debugging()
    return asyncio.run(_async_prune_stale_sessions())


async def _async_prune_stale_sessions() -> int:
    from .browser import BrowserAdapter
    async with BrowserAdapter() as adapter:
        return await adapter.prune_stale_sessions()


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
    # Ensure Chrome is ready (idempotent)
    from llm_burst.chrome_bootstrap import ensure_remote_debugging
    ensure_remote_debugging()

    # Generate placeholder if caller supplied no explicit name
    if task_name is None:  # type: ignore[arg-type]
        task_name = _generate_placeholder(provider)

    return asyncio.run(_async_open_window(task_name, provider))


async def _async_open_window(task_name: str, provider: LLMProvider) -> SessionHandle:
    """Internal async implementation for open_llm_window."""
    async with BrowserAdapter() as adapter:
        return await adapter.open_window(task_name, provider)


def send_prompt_sync(
    handle_or_task: Union[SessionHandle, str],
    prompt: str,
    *,
    follow_up: bool = False,
    research: bool = False,
    incognito: bool = False,
) -> None:
    """
    Inject *prompt* into an existing session (synchronously).

    Parameters
    ----------
    handle_or_task : SessionHandle | str
        Session handle or task name.
    prompt : str
        Text to send.
    follow_up : bool, optional
        Use provider's FOLLOWUP_JS. Defaults to False.
    research : bool, optional
        Enable research / deep-search mode where supported. Defaults to False.
    incognito : bool, optional
        Enable incognito / private mode where supported. Defaults to False.
    """
    asyncio.run(
        _async_send_prompt(
            handle_or_task,
            prompt,
            follow_up=follow_up,
            research=research,
            incognito=incognito,
        )
    )


async def _async_send_prompt(
    handle_or_task: Union[SessionHandle, str],
    prompt: str,
    *,
    follow_up: bool = False,
    research: bool = False,
    incognito: bool = False,
) -> None:
    from .state import StateManager
    from .browser import BrowserAdapter
    from llm_burst.providers import get_injector, InjectOptions

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

    opts = InjectOptions(
        follow_up=follow_up,
        research=research,
        incognito=incognito,
    )
    injector = get_injector(provider)
    await injector(page, prompt, opts)


def send_prompt_by_target_sync(
    provider: LLMProvider,
    target_id: str,
    prompt: str,
    *,
    follow_up: bool = False,
    research: bool = False,
    incognito: bool = False,
) -> None:
    """
    Inject *prompt* into a page identified by *target_id* under the specified *provider*.

    This bypasses name-based lookups entirely and is resilient to display-name changes.
    """
    asyncio.run(
        _async_send_prompt_by_target(
            provider,
            target_id,
            prompt,
            follow_up=follow_up,
            research=research,
            incognito=incognito,
        )
    )


async def _async_send_prompt_by_target(
    provider: LLMProvider,
    target_id: str,
    prompt: str,
    *,
    follow_up: bool = False,
    research: bool = False,
    incognito: bool = False,
) -> None:
    from .browser import BrowserAdapter
    from llm_burst.providers import get_injector, InjectOptions

    async with BrowserAdapter() as adapter:
        page = await adapter._find_page_for_target(target_id)
        if page is None:
            raise RuntimeError(f"Could not locate page for target '{target_id}'")

        opts = InjectOptions(
            follow_up=follow_up,
            research=research,
            incognito=incognito,
        )
        injector = get_injector(provider)
        await injector(page, prompt, opts)


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
