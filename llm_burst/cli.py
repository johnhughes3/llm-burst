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


def _run_jxa_prompt(
    clipboard_text: str = "",
    debug: bool = False,
    active_sessions: Optional[list[str]] = None,
) -> Dict[str, Any] | None:
    """
    Run JXA (JavaScript for Automation) dialog using native macOS AppKit.

    Returns dict with prompt data on success, None on failure/cancel.
    """
    jxa_script = """
    ObjC.import('AppKit');
    ObjC.import('Foundation');

    // Ensure NSApplication is initialized and the process is frontmost
    var app = $.NSApplication.sharedApplication; // accessed as property, not method
    // Use Regular so the alert can show reliably from CLI
    if (typeof $.NSApplicationActivationPolicyRegular !== 'undefined') {
        app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
    }
    
    // Enhanced activation to ensure dialog comes to front
    // Step 1: Activate the application
    if (typeof $.NSRunningApplication !== 'undefined') {
        var me = $.NSRunningApplication.currentApplication;
        if (me && me.activateWithOptions) {
            var opt = (typeof $.NSApplicationActivateIgnoringOtherApps !== 'undefined')
                ? $.NSApplicationActivateIgnoringOtherApps : 1; // fallback
            me.activateWithOptions(opt);
        }
    } else {
        app.activateIgnoringOtherApps(true);
    }
    
    // Step 2: Bring all windows to front
    if (app.windows && app.windows.count() > 0) {
        var windows = app.windows;
        for (var i = 0; i < windows.count(); i++) {
            var window = windows.objectAtIndex(i);
            if (window && window.makeKeyAndOrderFront) {
                window.makeKeyAndOrderFront(null);
            }
        }
    }
    
    // Step 3: Set application to be active and frontmost
    if (app.activateIgnoringOtherApps) {
        app.activateIgnoringOtherApps(true);
    }
    
    // Step 4: Ensure we're not in background-only mode
    if (app.setActivationPolicy) {
        // NSApplicationActivationPolicyRegular = 0
        app.setActivationPolicy(0);
    }

    // Read clipboard text from NSPasteboard by default; allow env override
    function readClipboard() {
        var pb = $.NSPasteboard.generalPasteboard;
        var s = pb.stringForType($.NSPasteboardTypeString) || pb.stringForType('public.utf8-plain-text');
        return s ? ObjC.unwrap(s) : '';
    }
    var env = $.NSProcessInfo.processInfo.environment;
    var clipEnv = env.objectForKey('LLM_BURST_CLIPBOARD');
    var clipboardText = clipEnv ? ObjC.unwrap(clipEnv) : readClipboard();

    // Read active sessions from environment variable if present
    var sessionsEnv = env.objectForKey('LLM_BURST_ACTIVE_SESSIONS');
    var activeSessions = [];
    if (sessionsEnv) {
        try {
            activeSessions = JSON.parse(ObjC.unwrap(sessionsEnv));
        } catch (e) {
            // console.error not available in JXA - silently ignore parse errors
            activeSessions = [];
        }
    }

    // Backward/forward compatible control state constants
    var StateOn = (typeof $.NSControlStateValueOn !== 'undefined') ? $.NSControlStateValueOn : $.NSOnState;
    var StateOff = (typeof $.NSControlStateValueOff !== 'undefined') ? $.NSControlStateValueOff : $.NSOffState;

    // Create alert (use property access for alloc and init in JXA)
    var alert = $.NSAlert.alloc.init;
    alert.addButtonWithTitle('OK');
    alert.addButtonWithTitle('Cancel');
    // Make Cmd+Return trigger OK even when focus is in the text view
    var okButton = alert.buttons.objectAtIndex(0);
    if (okButton && okButton.setKeyEquivalent && okButton.setKeyEquivalentModifierMask) {
        okButton.setKeyEquivalent('\\r');
        if (typeof $.NSEventModifierFlagCommand !== 'undefined') {
            okButton.setKeyEquivalentModifierMask($.NSEventModifierFlagCommand);
        }
    }
    
    // Add Cancel button shortcut (Escape)
    var cancelButton = alert.buttons.objectAtIndex(1);
    if (cancelButton && cancelButton.setKeyEquivalent) {
        cancelButton.setKeyEquivalent('\\x1b'); // Escape key
    }

    // Determine layout dimensions
    var viewWidth = 500;
    var baseHeight = 250;
    var sessionSelectorHeight = 0;
    var sessionSelector = null;

    if (activeSessions && activeSessions.length > 0) {
        sessionSelectorHeight = 50; // Height for label and dropdown
        baseHeight += sessionSelectorHeight;
        alert.messageText = 'LLM Burst Follow-up'; // Change title if we are selecting sessions
        alert.informativeText = 'Select session and confirm prompt:\\n\\nTip: Press ⌘↩ to submit';
    } else {
        alert.messageText = 'Start LLM Burst';
        alert.informativeText = 'Please confirm your prompt from clipboard:\\n\\nTip: Press ⌘↩ to submit';
    }

    // Accessory view containing a scrollable, editable text view and checkboxes
    var containerView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, viewWidth, baseHeight));

    // Session Selector (if applicable)
    if (sessionSelectorHeight > 0) {
        // Position the dropdown near the top (Coordinates are from bottom-left)
        var dropdownY = baseHeight - 48;
        var labelY = baseHeight - 20;

        var label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, labelY, viewWidth, 18));
        label.stringValue = "Target Session:";
        label.editable = false;
        label.bezeled = false;
        label.drawsBackground = false;
        containerView.addSubview(label);

        sessionSelector = $.NSPopUpButton.alloc.initWithFrame($.NSMakeRect(0, dropdownY, viewWidth, 25));
        sessionSelector.addItemsWithTitles(activeSessions);
        containerView.addSubview(sessionSelector);
    }

    // Text View (adjust position and height based on session selector)
    var bottomAreaHeight = 40; // Height for checkboxes and margin
    var textViewHeight = baseHeight - bottomAreaHeight - sessionSelectorHeight;
    var scrollViewY = bottomAreaHeight;

    var scrollView = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(0, scrollViewY, viewWidth, textViewHeight));
    scrollView.hasVerticalScroller = true;
    scrollView.hasHorizontalScroller = false;
    scrollView.borderType = $.NSBezelBorder;

    var textView = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, viewWidth, textViewHeight));
    textView.string = clipboardText;
    textView.editable = true;
    textView.selectable = true;
    textView.richText = false;
    textView.font = $.NSFont.systemFontOfSize(13);
    scrollView.documentView = textView;

    // Checkboxes along the bottom with keyboard shortcuts
    var researchCheck = $.NSButton.alloc.initWithFrame($.NSMakeRect(0, 14, 200, 18));
    researchCheck.setButtonType($.NSSwitchButton);
    researchCheck.title = 'Research mode (⌘R)';
    researchCheck.state = StateOff;
    // Set up keyboard shortcut for research mode
    if (researchCheck.setKeyEquivalent) {
        researchCheck.setKeyEquivalent('r');
        if (typeof $.NSEventModifierFlagCommand !== 'undefined') {
            researchCheck.setKeyEquivalentModifierMask($.NSEventModifierFlagCommand);
        }
    }

    var incognitoCheck = $.NSButton.alloc.initWithFrame($.NSMakeRect(220, 14, 200, 18));
    incognitoCheck.setButtonType($.NSSwitchButton);
    incognitoCheck.title = 'Incognito mode (⌘I)';
    incognitoCheck.state = StateOff;
    // Set up keyboard shortcut for incognito mode
    if (incognitoCheck.setKeyEquivalent) {
        incognitoCheck.setKeyEquivalent('i');
        if (typeof $.NSEventModifierFlagCommand !== 'undefined') {
            incognitoCheck.setKeyEquivalentModifierMask($.NSEventModifierFlagCommand);
        }
    }

    containerView.addSubview(scrollView);
    containerView.addSubview(researchCheck);
    containerView.addSubview(incognitoCheck);

    alert.setAccessoryView(containerView);
    try {
        // Some macOS versions require a window before setting first responder
        alert.layout; // invoke 0-arg method via property access
        
        // Ensure the alert window comes to front
        if (alert.window) {
            // Make the window key and bring it to front
            if (alert.window.makeKeyAndOrderFront) {
                alert.window.makeKeyAndOrderFront(null);
            }
            
            // Set the window level to ensure it's above other windows
            // NSFloatingWindowLevel = 3, NSModalPanelWindowLevel = 8
            if (alert.window.setLevel) {
                var NSModalPanelWindowLevel = 8;
                alert.window.setLevel(NSModalPanelWindowLevel);
            }
            
            // Center the window on screen
            if (alert.window.center) {
                alert.window.center();
            }
            
            // Set initial first responder
            alert.window.setInitialFirstResponder(textView);
        }
        
        // Enable standard text editing shortcuts in the text view
        if (textView.setAutomaticTextReplacementEnabled) {
            textView.setAutomaticTextReplacementEnabled(false);
        }
        if (textView.setAllowsUndo) {
            textView.setAllowsUndo(true);
        }
        
        // Set up tab key to move between fields
        // Tab moves focus from textView -> sessionSelector (if exists) -> researchCheck -> incognitoCheck
        // Shift+Tab moves in reverse
        if (alert.window && alert.window.setAutorecalculatesKeyViewLoop) {
            alert.window.setAutorecalculatesKeyViewLoop(true);
        }
    } catch (e) {}

    // Final activation right before showing dialog
    if (app.activateIgnoringOtherApps) {
        app.activateIgnoringOtherApps(true);
    }
    
    // Show dialog (0-arg methods are properties in JXA)
    var response = alert.runModal;
    
    // Accept both modern and legacy "OK" codes; treat others as cancel
    // NOTE: NSAlertFirstButtonReturn and runModal both return strings in JXA
    var okCode = $.NSAlertFirstButtonReturn || "1000";
    
    // Return JSON result as the script's value
    var result;
    if (response != okCode) {  // Use != for type-coercing comparison
        // Return special marker for cancellation
        result = {"__cancelled__": true};
    } else {
        result = {
            "Prompt Text": ObjC.unwrap(textView.string),
            "Research mode": (researchCheck.state === StateOn),
            "Incognito mode": (incognitoCheck.state === StateOn)
        };
        if (sessionSelector) {
            result["Selected Session"] = ObjC.unwrap(sessionSelector.titleOfSelectedItem);
        }
    }
    JSON.stringify(result);
    """

    # Check debug mode
    if debug or os.getenv("LLM_BURST_DEBUG") == "1":
        debug = True

    try:
        env = os.environ.copy()
        if clipboard_text:
            env["LLM_BURST_CLIPBOARD"] = clipboard_text

        if active_sessions:
            env["LLM_BURST_ACTIVE_SESSIONS"] = json.dumps(active_sessions)

        if debug:
            print(
                f"DEBUG: Running osascript with clipboard: {clipboard_text[:50] if clipboard_text else 'None'}...",
                file=sys.stderr,
            )

        result = subprocess.run(
            ["/usr/bin/osascript", "-l", "JavaScript", "-e", jxa_script],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            env=env,
        )

        if debug:
            print(
                f"DEBUG: osascript returned code: {result.returncode}", file=sys.stderr
            )
            print(
                f"DEBUG: stdout: {result.stdout[:100] if result.stdout else 'None'}",
                file=sys.stderr,
            )
            if result.stderr:
                print(f"DEBUG: stderr: {result.stderr[:200]}", file=sys.stderr)

        if result.returncode == 0 and result.stdout:
            parsed = json.loads(result.stdout.strip())
            if debug:
                print(f"DEBUG: Parsed JSON: {parsed}", file=sys.stderr)
            return parsed
        elif result.returncode == 1:
            # User cancelled - return special marker
            if debug:
                print("DEBUG: Return code 1 - user cancelled", file=sys.stderr)
            return {"__cancelled__": True}
        else:
            # Some other error
            if result.stderr:
                print(f"JXA dialog error: {result.stderr}", file=sys.stderr)
            if debug:
                print(
                    f"DEBUG: Unexpected return code: {result.returncode}",
                    file=sys.stderr,
                )
            return None
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
        print(f"JXA dialog failed: {e}", file=sys.stderr)
        return None


def _bring_terminal_to_front():
    """Bring the Terminal app to front using osascript."""
    try:
        # Try to activate Terminal.app
        subprocess.run(
            ["osascript", "-e", 'tell application "Terminal" to activate'],
            capture_output=True,
            timeout=1,
        )
    except Exception:
        # If Terminal fails, try to activate the current process
        try:
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    'tell application "System Events" to set frontmost of (first process whose unix id is {}) to true'.format(
                        os.getpid()
                    ),
                ],
                capture_output=True,
                timeout=1,
            )
        except Exception:
            pass  # Silent fail if we can't bring to front


def prompt_user(
    gui: bool | None = None,
    debug: bool = False,
    active_sessions: Optional[list[str]] = None,
) -> Dict[str, Any]:
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
    # Check for debug mode
    if debug or os.getenv("LLM_BURST_DEBUG") == "1":
        debug = True
        print(f"DEBUG: prompt_user called with gui={gui}", file=sys.stderr)

    # Decide whether to use GUI prompt
    if gui is None:
        # Default to NO dialog unless explicitly opted-in via env
        use_dialog = os.getenv("LLM_BURST_USE_DIALOG", "").lower() in {
            "1",
            "true",
            "yes",
        }
        if debug:
            print(
                f"DEBUG: gui is None, use_dialog={use_dialog} (from env)",
                file=sys.stderr,
            )
    else:
        use_dialog = bool(gui)
        if debug:
            print(f"DEBUG: gui={gui}, use_dialog={use_dialog}", file=sys.stderr)

    # Honour explicit opt-out: skip dialog entirely when requested
    no_dialog = os.getenv("LLM_BURST_NO_DIALOG", "").lower() in {"1", "true", "yes"}
    if debug:
        print(f"DEBUG: no_dialog={no_dialog}, use_dialog={use_dialog}", file=sys.stderr)

    if no_dialog or not use_dialog:
        if debug:
            print("DEBUG: Skipping dialog, using clipboard", file=sys.stderr)
        try:
            clipboard_text: str = pyperclip.paste()
        except Exception as e:
            clipboard_text = ""
            if debug:
                print(f"DEBUG: Failed to get clipboard: {e}", file=sys.stderr)
        if clipboard_text:
            if debug:
                print(
                    f"DEBUG: Returning clipboard text: {clipboard_text[:50]}...",
                    file=sys.stderr,
                )
            return {
                "Prompt Text": clipboard_text,
                "Research mode": False,
                "Incognito mode": False,
            }
        # Nothing sensible to return – behave like cancel/missing dialog
        if debug:
            print("DEBUG: No clipboard content, returning empty", file=sys.stderr)
        return {}

    # Grab clipboard to pre-seed the dialog
    try:
        clipboard_text: str = pyperclip.paste()
        if debug:
            print(
                f"DEBUG: Clipboard content: {clipboard_text[:50] if clipboard_text else 'None'}...",
                file=sys.stderr,
            )
    except Exception as e:
        clipboard_text = ""
        if debug:
            print(f"DEBUG: Failed to get clipboard: {e}", file=sys.stderr)

    # Bring Terminal to front before showing dialog
    _bring_terminal_to_front()

    # Try native JXA dialog first (most reliable on macOS)
    if debug:
        print("DEBUG: Running JXA dialog...", file=sys.stderr)
    jxa_result = _run_jxa_prompt(
        clipboard_text, debug=debug, active_sessions=active_sessions
    )
    if debug:
        print(f"DEBUG: JXA returned: {jxa_result}", file=sys.stderr)

    if jxa_result is not None:
        # Check if user cancelled
        if jxa_result.get("__cancelled__"):
            if debug:
                print(
                    f"DEBUG: User cancelled dialog, exiting with code {PROMPT_CANCEL_EXIT}",
                    file=sys.stderr,
                )
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


def open_llm_window(task_name: str | None, provider: LLMProvider) -> SessionHandle:
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
