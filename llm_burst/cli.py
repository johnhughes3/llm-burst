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
    PROMPT_CANCEL_EXIT,
    LLMProvider,
)
from .browser import BrowserAdapter, SessionHandle


def _run_jxa_prompt(clipboard_text: str = "") -> Dict[str, Any] | None:
    """
    Run JXA (JavaScript for Automation) dialog using native macOS AppKit.
    
    Returns dict with prompt data on success, None on failure/cancel.
    """
    jxa_script = '''
    ObjC.import('AppKit');
    ObjC.import('stdlib');
    
    // Activate app to bring dialog to front
    $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
    
    // Get clipboard text if not provided
    var clipboardText = arguments[0] || '';
    if (!clipboardText) {
        var pb = $.NSPasteboard.generalPasteboard;
        var clipData = pb.stringForType($.NSPasteboardTypeString) || 
                       pb.stringForType($('public.utf8-plain-text'));
        clipboardText = clipData ? clipData.toString() : '';
    }
    
    // Create alert
    var alert = $.NSAlert.alloc.init;
    alert.messageText = 'Start LLM Burst';
    alert.informativeText = 'Please confirm your prompt from clipboard:\\n\\nKeyboard shortcuts: Press ⌘↩ (Cmd+Return) to submit';
    alert.addButtonWithTitle('OK');
    alert.addButtonWithTitle('Cancel');
    
    // Create text view for multiline input
    var scrollView = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(0, 0, 450, 200));
    scrollView.hasVerticalScroller = true;
    scrollView.hasHorizontalScroller = false;
    scrollView.borderType = $.NSBezelBorder;
    
    var textView = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, 450, 200));
    textView.string = clipboardText;
    textView.editable = true;
    textView.selectable = true;
    textView.richText = false;
    textView.font = $.NSFont.systemFontOfSize(13);
    
    scrollView.documentView = textView;
    
    // Create checkboxes
    var containerView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, 450, 250));
    
    var researchCheck = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 210, 200, 18));
    researchCheck.setButtonType($.NSSwitchButton);
    researchCheck.title = 'Research mode';
    researchCheck.state = $.NSOffState;
    
    var incognitoCheck = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 230, 200, 18));
    incognitoCheck.setButtonType($.NSSwitchButton);
    incognitoCheck.title = 'Incognito mode';
    incognitoCheck.state = $.NSOffState;
    
    containerView.addSubview(scrollView);
    containerView.addSubview(researchCheck);
    containerView.addSubview(incognitoCheck);
    
    alert.accessoryView = containerView;
    
    // Show dialog
    var response = alert.runModal();
    
    if (response === $.NSAlertSecondButtonReturn) {
        // Cancel button
        $.exit(1);
    }
    
    // Return JSON result
    var result = {
        "Prompt Text": textView.string.toString(),
        "Research mode": researchCheck.state === $.NSOnState,
        "Incognito mode": incognitoCheck.state === $.NSOnState
    };
    
    console.log(JSON.stringify(result));
    '''
    
    try:
        result = subprocess.run(
            ["/usr/bin/osascript", "-l", "JavaScript", "-e", jxa_script, "--", clipboard_text],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0 and result.stdout:
            return json.loads(result.stdout.strip())
        elif result.returncode == 1:
            # User cancelled - return special marker
            return {"__cancelled__": True}
        else:
            # Some other error
            if result.stderr:
                print(f"JXA dialog error: {result.stderr}", file=sys.stderr)
            return None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
        print(f"JXA dialog failed: {e}", file=sys.stderr)
        return None


def prompt_user(gui: bool | None = None) -> Dict[str, Any]:
    """
    Launch a native macOS prompt and return the user's input.

    Returns
    -------
    dict
        The JSON data with user input, parsed into a dictionary.

    Side Effects
    ------------
    - If the user cancels (non-zero exit code) the current process terminates
      with PROMPT_CANCEL_EXIT.

    Raises
    ------
    SystemExit
        If the user cancels the dialog.
    """
    # Decide whether to use GUI prompt
    if gui is None:
        # Default to NO dialog unless explicitly opted-in via env
        use_dialog = os.getenv("LLM_BURST_USE_DIALOG", "").lower() in {
            "1",
            "true",
            "yes",
        }
    else:
        use_dialog = bool(gui)

    # Honour explicit opt-out: skip dialog entirely when requested
    no_dialog = os.getenv("LLM_BURST_NO_DIALOG", "").lower() in {"1", "true", "yes"}
    if no_dialog or not use_dialog:
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

    # Grab clipboard to pre-seed the dialog
    try:
        clipboard_text: str = pyperclip.paste()
    except Exception:
        clipboard_text = ""

    # Try native JXA dialog first (most reliable on macOS)
    jxa_result = _run_jxa_prompt(clipboard_text)
    if jxa_result is not None:
        # Check if user cancelled
        if jxa_result.get("__cancelled__"):
            sys.exit(PROMPT_CANCEL_EXIT)
        return jxa_result
    
    # JXA failed - fall back to clipboard if available
    if clipboard_text:
        print(
            "Using clipboard content as fallback (native dialog unavailable)",
            file=sys.stderr,
        )
        return {
            "Prompt Text": clipboard_text,
            "Research mode": False,
            "Incognito mode": False,
        }
    
    # No clipboard content and dialog failed - treat as cancel
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
    if task_name is None:
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

    # Determine provider and target
    page = None
    provider: LLMProvider | None = None
    target_id: str | None = None

    if isinstance(handle_or_task, SessionHandle):
        provider = handle_or_task.live.provider
        target_id = handle_or_task.live.target_id
        try:
            if not handle_or_task.page.is_closed():
                page = handle_or_task.page
        except Exception:
            page = None
    else:
        task_name = handle_or_task
        state = StateManager()
        session = state.get(task_name)
        if session is None:
            raise RuntimeError(f"No live session found for task '{task_name}'")
        provider = session.provider
        target_id = session.target_id

    # Ensure we have a live Page; rehydrate once if needed
    if page is None:
        if target_id is None or provider is None:
            raise RuntimeError("Missing provider/target for prompt injection")
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
            return

    # Verify page still alive just before use
    try:
        closed = page.is_closed()
    except Exception:
        closed = True
    if closed:
        # One rehydrate attempt
        if target_id is None or provider is None:
            raise RuntimeError("Page closed and target unknown for rehydration")
        async with BrowserAdapter() as adapter:
            new_page = await adapter._find_page_for_target(target_id)
            if new_page is None:
                raise RuntimeError(
                    f"Could not locate page for target '{target_id}' after rehydration"
                )
            opts = InjectOptions(
                follow_up=follow_up,
                research=research,
                incognito=incognito,
            )
            injector = get_injector(provider)
            await injector(new_page, prompt, opts)
            return

    # Normal path
    opts = InjectOptions(
        follow_up=follow_up,
        research=research,
        incognito=incognito,
    )
    injector = get_injector(provider)  # type: ignore[arg-type]
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


async def _async_auto_name_session(handle: SessionHandle) -> Optional[str]:
    """Rehydrate page if needed and run auto_namer within a live context."""
    from .auto_namer import auto_name_session
    from .browser import BrowserAdapter
    from .state import StateManager

    page = None
    try:
        if not handle.page.is_closed():
            page = handle.page
    except Exception:
        page = None

    if page is None:
        async with BrowserAdapter() as adapter:
            page = await adapter._find_page_for_target(handle.live.target_id)
            if page is None:
                return None
            # Refresh live session metadata
            state = StateManager()
            sess = state.get(handle.live.task_name)
            if sess:
                handle.live = sess
            return await auto_name_session(handle.live, page)

    # Verify still alive
    try:
        if page.is_closed():
            return await _async_auto_name_session(handle)
    except Exception:
        return await _async_auto_name_session(handle)

    return await auto_name_session(handle.live, page)


def auto_name_sync(handle: SessionHandle) -> Optional[str]:
    """
    Invoke the asynchronous auto-naming routine for *handle* and wait for
    completion. Handles closed page contexts by rehydrating.
    """
    return asyncio.run(_async_auto_name_session(handle))