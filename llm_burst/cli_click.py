"""
llm_burst.cli_click
-------------------

Stage-3: User-facing Click command-line interface.

Commands
--------
list   : Show running sessions
open   : Open (or reuse) an LLM window and optionally send a prompt
stop   : Close one or more running sessions
arrange: Arrange active windows via Chrome CDP
"""

from __future__ import annotations

import json
import logging
import os
import sys
import asyncio
import subprocess
from importlib import metadata
from typing import Optional

import click
from dotenv import load_dotenv, find_dotenv

from llm_burst.providers import get_injector, InjectOptions
from llm_burst.constants import LLMProvider, TabColor
from llm_burst.tab_groups import (
    create_group_sync,
    move_to_group_sync,
    list_groups_sync,
)
from llm_burst.cli import (
    open_llm_window,
    send_prompt_sync,
    get_running_sessions,
    close_llm_window_sync,
    prompt_user,
    auto_name_sync,  # Added
    prune_stale_sessions_sync,
)

_LOG = logging.getLogger(__name__)


def _task_slug(session_title: str, provider: LLMProvider) -> str:
    """Generate stable internal identifier - NEVER rename these."""
    # Use a stable pattern that won't change even if session_title is renamed
    import hashlib

    # Create stable hash from initial session title
    stable_id = hashlib.md5(f"{session_title}:{provider.name}".encode()).hexdigest()[:8]
    return f"internal_{provider.name.lower()}_{stable_id}"


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


@click.group()
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging.")
@click.version_option(metadata.version("llm-burst"))
@click.pass_context
def cli(ctx: click.Context, verbose: bool) -> None:  # noqa: D401  (Click demands plain name)
    """llm-burst – orchestrate multiple LLM chat sessions."""
    _configure_logging(verbose)
    # Best-effort .env loading early so downstream modules see env (e.g., GEMINI_API_KEY)
    try:
        discovered = find_dotenv(usecwd=True)
        if discovered:
            load_dotenv(discovered)
            _LOG.debug("Loaded .env at startup: %s", discovered)
    except Exception:
        pass
    ctx.ensure_object(dict)


# --------------------------------------------------------------------------- #
# list command                                                                #
# --------------------------------------------------------------------------- #


@cli.command("list")
@click.option(
    "-o",
    "--output",
    type=click.Choice(["table", "json"], case_sensitive=False),
    default="table",
    show_default=True,
    help="Output format.",
)
def cmd_list(output: str) -> None:
    """List running LLM sessions."""
    prune_stale_sessions_sync()
    sessions = get_running_sessions()
    # Also include multi-provider sessions (groups)
    from llm_burst.state import StateManager

    st = StateManager()
    mp_sessions = st.list_sessions()
    groups = st.list_groups()

    if output == "json":
        payload = {
            "sessions": {
                title: {
                    "grouped": sess.grouped,
                    "tabs": {
                        prov.name.lower(): {
                            "windowId": th.window_id,
                            "tabId": th.tab_id,
                        }
                        for prov, th in sess.tabs.items()
                    },
                }
                for title, sess in mp_sessions.items()
            },
            "windows": sessions,
            "groups": {
                gid: {"name": g.name, "color": g.color} for gid, g in groups.items()
            },
        }
        click.echo(json.dumps(payload, indent=2))
        return

    # Table view
    if mp_sessions:
        click.echo("Active Session Groups:")
        header = f"{'Title':30}  {'Grouped':7}  {'Providers':9}  Tabs"
        click.echo(header)
        click.echo("-" * len(header))
        for title, sess in mp_sessions.items():
            prov_count = len(sess.tabs)
            tabs_desc = ", ".join(
                f"{prov.name.lower()}:{th.tab_id}" for prov, th in sess.tabs.items()
            )
            click.echo(
                f"{title:30}  {str(sess.grouped):7}  {prov_count:9}  {tabs_desc}"
            )
        click.echo("")

    if sessions:
        click.echo("Live Windows/Tabs:")
        header = f"{'Task':30}  {'Provider':10}  TargetID / WindowID"
        click.echo(header)
        click.echo("-" * len(header))
        for task, info in sessions.items():
            click.echo(
                f"{task:30}  {info['provider']:10}  {info['target_id']} / {info['window_id']}"
            )
    else:
        if not mp_sessions:
            click.echo("No active sessions.")


# --------------------------------------------------------------------------- #
# open command                                                                #
# --------------------------------------------------------------------------- #


def _provider_from_str(raw: str) -> LLMProvider:
    try:
        return LLMProvider[raw.upper()]
    except KeyError as exc:
        raise click.BadParameter(f"Unknown provider '{raw}'") from exc


@cli.command("open")
@click.option(
    "-p",
    "--provider",
    type=str,
    help="LLM provider: gemini, claude, chatgpt, grok.",
)
@click.option("-t", "--task-name", type=str, help="Task name for tracking.")
@click.option(
    "-m",
    "--prompt-text",
    type=str,
    help="Prompt text to send after opening.",
)
@click.option(
    "-s",
    "--stdin",
    is_flag=True,
    help="Read prompt text from STDIN instead of argument.",
)
@click.option(
    "-n",
    "--new",
    "force_new",
    is_flag=True,
    help="Force creation of a new session. Fail if *task-name* already exists.",
)
@click.option(
    "-g",
    "--group",
    "group_name",
    type=str,
    help="Chrome tab-group name.",
)
@click.option(
    "--gui-prompt/--no-gui-prompt",
    default=False,
    show_default=True,
    help="Show GUI dialog for missing fields (default: off)",
)
@click.option(
    "--debug",
    is_flag=True,
    help="Enable debug logging for troubleshooting",
)
def cmd_open(
    provider: Optional[str],
    task_name: Optional[str],
    prompt_text: Optional[str],
    stdin: bool,
    force_new: bool,
    group_name: Optional[str],
    gui_prompt: bool,
    debug: bool,
) -> None:
    """Open a new LLM window (or re-attach) and optionally send a prompt."""
    import sys
    import traceback
    import os

    # Set debug environment variable for child processes
    if debug:
        os.environ["LLM_BURST_DEBUG"] = "1"
        print("DEBUG: Starting cmd_open with:", file=sys.stderr)
        print(f"  provider={provider}", file=sys.stderr)
        print(f"  task_name={task_name}", file=sys.stderr)
        print(
            f"  prompt_text={prompt_text[:50] if prompt_text else None}",
            file=sys.stderr,
        )
        print(f"  gui_prompt={gui_prompt}", file=sys.stderr)
        print(f"  stdin={stdin}", file=sys.stderr)

    try:
        if debug:
            print("DEBUG: Pruning stale sessions...", file=sys.stderr)
        prune_stale_sessions_sync()
        from llm_burst.chrome_bootstrap import ensure_remote_debugging  # Added

        if debug:
            print("DEBUG: Ensuring Chrome remote debugging...", file=sys.stderr)
        ensure_remote_debugging()  # Added

        # Merge missing values from swiftDialog prompt when any field absent
        need_dialog = (
            provider is None
            or (task_name is None and not force_new)
            or (prompt_text is None and not stdin)
        )

        if debug:
            print(f"DEBUG: Need dialog? {need_dialog}", file=sys.stderr)

        if need_dialog:
            if debug:
                print(
                    f"DEBUG: Calling prompt_user(gui={gui_prompt})...", file=sys.stderr
                )
            user_data = prompt_user(gui=gui_prompt, debug=debug)
            if debug:
                print(f"DEBUG: prompt_user returned: {user_data}", file=sys.stderr)
            provider = provider or user_data.get("provider")
            task_name = task_name or user_data.get("task_name") or user_data.get("task")
            prompt_text = (
                prompt_text
                or user_data.get("Prompt Text")
                or user_data.get("prompt_text")
                or user_data.get("prompt")
            )

        # Validation
        if provider is None:
            raise click.UsageError("provider is required")

        if force_new and task_name is None:
            raise click.UsageError("--new requires --task-name")

        provider_enum = _provider_from_str(provider)

        from llm_burst.state import StateManager

        state = StateManager()
        # Check for existence if --new is specified AND task_name is provided.
        if force_new and task_name is not None and task_name in state.list_all():
            raise click.ClickException(
                f"Session '{task_name}' already exists (--new flag set)."
            )

        # Read prompt text from STDIN if requested
        if stdin:
            prompt_text = sys.stdin.read()

        # Open / attach window
        handle = open_llm_window(task_name, provider_enum)
        actual_name = handle.live.task_name
        click.echo(f"Opened window '{actual_name}' → {provider_enum.name}")

        # Send prompt if provided
        if prompt_text:
            send_prompt_sync(handle, prompt_text)
            click.echo("Prompt sent.")

        # Attempt auto-naming when we used a placeholder (no explicit task_name)
        if task_name is None:
            new_name = auto_name_sync(handle)
            if new_name and new_name != actual_name:
                click.echo(f"Session renamed to '{new_name}'")
                actual_name = new_name  # ensure group op uses current name

        # NEW: assign to tab group if requested
        if group_name:
            try:
                move_to_group_sync(actual_name, group_name)
                click.echo(f"Added '{actual_name}' to group '{group_name}'.")
            except RuntimeError as exc:
                click.echo(f"Tab-group failed: {exc}", err=True)
    except SystemExit as e:
        print(f"ERROR: SystemExit with code {e.code}", file=sys.stderr)
        sys.exit(e.code)
    except Exception as e:
        print(f"ERROR: Unexpected error in cmd_open: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


# --------------------------------------------------------------------------- #
# activate command (⌃⌥R replacement)                                         #
# --------------------------------------------------------------------------- #


@cli.command("activate")
@click.option(
    "-t", "--title", "session_title", type=str, help="Session title / task name."
)
@click.option(
    "-m", "--prompt-text", type=str, help="Prompt to broadcast to all providers."
)
@click.option("-s", "--stdin", is_flag=True, help="Read prompt text from STDIN.")
@click.option("-r", "--research", is_flag=True, help="Enable research/deep mode.")
@click.option("-i", "--incognito", is_flag=True, help="Enable incognito/private mode.")
@click.option(
    "-l",
    "--layout",
    type=click.Choice(["cdp", "none"], case_sensitive=False),
    default=lambda: os.getenv("LLM_BURST_LAYOUT", "cdp"),
    show_default=True,
    help="Window arrangement strategy after activation.",
)
@click.option(
    "--gui-prompt/--no-gui-prompt",
    default=False,
    show_default=True,
    help="Show GUI dialog for missing fields (default: off)",
)
@click.option(
    "--tabs/--windows",
    "as_tabs",
    default=True,  # Changed to True to default to tabs mode
    show_default=True,
    help="Open one window with four tabs instead of four windows (default: tabs).",
)
def cmd_activate(
    session_title: str | None,
    prompt_text: str | None,
    stdin: bool,
    research: bool,
    incognito: bool,
    layout: str,
    gui_prompt: bool,
    as_tabs: bool,
) -> None:
    """Open 4 LLM sessions and send the same prompt (⌃⌥R replacement)."""
    prune_stale_sessions_sync()
    from llm_burst.chrome_bootstrap import ensure_remote_debugging  # Added

    ensure_remote_debugging()  # Added

    from datetime import datetime
    from llm_burst.state import StateManager
    from llm_burst.browser import BrowserAdapter, set_window_title

    # 1️⃣ Gather any missing fields from swiftDialog
    if prompt_text is None and not stdin:
        try:
            data = prompt_user(gui=gui_prompt)
            prompt_text = (
                prompt_text
                or data.get("Prompt Text")
                or data.get("prompt_text")
                or data.get("prompt")
            )
            if not research and data.get("Research mode"):
                research = True
            if not incognito and data.get("Incognito mode"):
                incognito = True
        except (FileNotFoundError, OSError, subprocess.CalledProcessError) as e:
            # Dialog not available or failed – try clipboard fallback
            _LOG.debug(f"Dialog failed: {e}")
            try:
                import pyperclip

                clipboard_text = pyperclip.paste()
                if clipboard_text and clipboard_text.strip():
                    prompt_text = clipboard_text
                    click.echo("Using clipboard content as prompt (dialog unavailable)")
            except Exception:
                pass

    # Auto-generate a nice title (timestamp) when still missing
    auto_generated = False  # Track if we created a placeholder title
    if session_title is None:
        auto_generated = True
        session_title = datetime.now().strftime("%a, %b %d, %Y %I:%M%p")

    # Stdin overrides everything for prompt text
    if stdin:
        import sys

        prompt_text = sys.stdin.read()

    if prompt_text is None or not prompt_text.strip():
        raise click.UsageError(
            "Prompt text required (via --prompt-text, --stdin, or dialog)"
        )

    providers = list(LLMProvider)  # All known providers for now

    # Helper coroutine for concurrent open/prompt
    # Helper: truncate names to a safe length for tab groups
    def _truncate_name(name: str, limit: int = 80) -> str:
        return name if len(name) <= limit else name[: limit - 1] + "…"

    async def _async_activate(as_tabs: bool = False) -> tuple[list[str], str]:
        """Open all provider windows and send prompt while BrowserAdapter is alive."""
        # Late import to keep GAI optional
        from llm_burst.auto_namer import suggest_session_name

        opened_providers: list[str] = []
        handles: list = []
        state = StateManager()
        current_title = session_title
        suggested_name: str | None = None

        # Create or reuse the session record
        if state.get_session(current_title):
            click.echo(f"Re-using existing session '{current_title}'")
        else:
            state.create_session(current_title)

        async with BrowserAdapter() as adapter:
            if as_tabs:
                # 1) Prefer to open the first provider as a new TAB in an existing window
                #    (to avoid spawning a separate window for the first tab)
                first_prov = providers[0]
                first_slug = _task_slug(current_title, first_prov)
                opener = await adapter.pick_existing_window_opener()
                if opener:
                    opener_target_id, _opener_window_id = opener
                    try:
                        first_handle = await adapter.open_tab_in_window(
                            first_slug, first_prov, opener_target_id
                        )
                    except Exception:
                        # Fallback: create a new window if tab creation fails
                        first_handle = await adapter.open_window(first_slug, first_prov)
                else:
                    # No existing windows – create a new one as before
                    first_handle = await adapter.open_window(first_slug, first_prov)
                handles.append(first_handle)
                opened_providers.append(first_prov.name.lower())
                state.add_tab_to_session(
                    session_title,
                    first_prov,
                    first_handle.live.window_id,
                    first_handle.live.target_id,
                )

                # Set initial tab/window titles for visibility
                try:
                    await set_window_title(first_handle.page, current_title)
                except Exception:
                    pass

                # 2) Open remaining providers as tabs in the same window
                for prov in providers[1:]:
                    slug = _task_slug(current_title, prov)
                    try:
                        handle = await adapter.open_tab_in_window(
                            slug, prov, first_handle.live.target_id
                        )
                    except Exception as exc:
                        click.echo(f"Failed to open {prov.name} tab: {exc}", err=True)
                        continue
                    handles.append(handle)
                    opened_providers.append(prov.name.lower())
                    state.add_tab_to_session(
                        session_title,
                        prov,
                        handle.live.window_id,
                        handle.live.target_id,
                    )
                    try:
                        await set_window_title(handle.page, current_title)
                    except Exception:
                        pass

                # 3) Create a Chrome tab group using the extension
                group_name = _truncate_name(current_title)
                extension_available = False
                grouped_count = 0
                
                # Check if extension is available using the first tab
                if handles:
                    extension_available = await adapter.check_extension_available(handles[0].page)
                    if not extension_available:
                        click.echo(
                            "Chrome tab grouping requires the LLM Burst Helper extension.\n"
                            "To install: Open chrome://extensions, enable Developer mode, "
                            "click 'Load unpacked', and select the 'chrome_ext' folder.",
                            err=True
                        )
                
                # Try to group tabs via extension
                if extension_available:
                    for h in handles:
                        try:
                            success = await adapter.group_tab_via_extension(
                                h.page, group_name, "blue", current_title
                            )
                            if success:
                                grouped_count += 1
                                # Track in state for consistency
                                state.assign_session_to_group(h.live.task_name, 1)
                        except Exception as exc:
                            _LOG.debug(f"Failed to group tab {h.live.provider.name}: {exc}")
                    
                    if grouped_count > 0:
                        state.set_grouped(session_title, True)
                        click.echo(f"Grouped {grouped_count} tabs into '{group_name}'")
                    else:
                        click.echo("Tab grouping failed - tabs opened without groups", err=True)

                # 4) Inject prompts into each tab
                for h in handles:
                    try:
                        injector = get_injector(h.live.provider)
                        opts = InjectOptions(
                            follow_up=False, research=research, incognito=incognito
                        )
                        await injector(h.page, prompt_text, opts)
                    except Exception as exc:
                        click.echo(
                            f"Injection failed for {h.live.provider.name}: {exc}",
                            err=True,
                        )

                # 5) Try Gemini name suggestion using the first successful handle
                if auto_generated:
                    for h in handles:
                        try:
                            suggested_name = await suggest_session_name(
                                h.page, h.live.provider
                            )
                            if suggested_name:
                                _LOG.info(
                                    "Name suggestion produced: %s", suggested_name
                                )
                                break
                        except Exception:
                            _LOG.debug(
                                "Name suggestion attempt failed for %s", h.live.provider
                            )
                            continue

                # 6) Apply rename (session + tab-group title where possible)
                if auto_generated and suggested_name:
                    if state.rename_session(current_title, suggested_name):
                        click.echo(f"Session renamed to '{suggested_name}'")
                        current_title = suggested_name
                        # Update titles in browser
                        for h in handles:
                            try:
                                await set_window_title(h.page, current_title)
                            except Exception:
                                pass
                        # Note: Group title update would require extension support
                        # Current extension doesn't support renaming existing groups

                # Bring Chrome to front after opening all tabs
                from llm_burst.browser import bring_chrome_to_front

                bring_chrome_to_front()

                state.persist_now()
                return opened_providers, current_title

            # WINDOWS MODE -------------------------------------------------
            # 1) Open all windows first (no prompts)
            for prov in providers:
                slug = _task_slug(current_title, prov)
                try:
                    handle = await adapter.open_window(slug, prov)
                except Exception as exc:
                    click.echo(f"Failed to open {prov.name}: {exc}", err=True)
                    continue
                handles.append(handle)
                opened_providers.append(prov.name.lower())
                state.add_tab_to_session(
                    session_title, prov, handle.live.window_id, handle.live.target_id
                )
                try:
                    await set_window_title(handle.page, current_title)
                except Exception:
                    pass

            state.persist_now()

            # 2) Arrange windows before sending prompts (per requirement)
            if not research and len(handles) > 1 and layout.lower() != "none":
                try:
                    from llm_burst.layout import arrange

                    arrange(len(handles))
                    click.echo("✓ Windows arranged")
                except Exception:
                    pass

            # 3) Inject prompts into each window
            for h in handles:
                try:
                    injector = get_injector(h.live.provider)
                    opts = InjectOptions(
                        follow_up=False, research=research, incognito=incognito
                    )
                    await injector(h.page, prompt_text, opts)
                except Exception as exc:
                    click.echo(
                        f"Injection failed for {h.live.provider.name}: {exc}", err=True
                    )

            # 4) Attempt name suggestion from first handle (post-injection)
            if auto_generated and handles:
                try:
                    suggested_name = await suggest_session_name(
                        handles[0].page, handles[0].live.provider
                    )
                    if suggested_name:
                        _LOG.info("Name suggestion produced: %s", suggested_name)
                except Exception:
                    suggested_name = None

            # 5) Apply rename
            if auto_generated and suggested_name:
                if state.rename_session(current_title, suggested_name):
                    click.echo(f"Session renamed to '{suggested_name}'")
                    current_title = suggested_name
                    for h in handles:
                        try:
                            await set_window_title(h.page, current_title)
                        except Exception:
                            pass

            # Bring Chrome to front after everything is set up
            from llm_burst.browser import bring_chrome_to_front

            bring_chrome_to_front()

            # Flush state
            state.persist_now()
            return opened_providers, current_title

    # Tabs mode is controlled via env for now (—tabs flag added below)
    opened, session_title = asyncio.run(_async_activate(as_tabs=as_tabs))

    click.echo(f"✓ Session '{session_title}' activated with {len(opened)} provider(s)")

    # No-op: arrangement already handled earlier for windows mode


# --------------------------------------------------------------------------- #
# stop command                                                                #
# --------------------------------------------------------------------------- #


@cli.command("stop")
@click.option("-t", "--task-name", "task_names", multiple=True, help="Task(s) to stop.")
@click.option("-a", "--all", "stop_all", is_flag=True, help="Stop all sessions.")
def cmd_stop(task_names: tuple[str, ...], stop_all: bool) -> None:
    """Close one or more running LLM windows."""
    prune_stale_sessions_sync()
    sessions = get_running_sessions()
    if stop_all:
        targets = list(sessions.keys())
    else:
        if not task_names:
            raise click.UsageError("Provide --task-name or --all")
        targets = list(task_names)

    closed = 0
    for task in targets:
        ok = close_llm_window_sync(task)
        if ok:
            closed += 1
            click.echo(f"Closed '{task}'")
        else:
            click.echo(f"No active window for '{task}'", err=True)

    click.echo(f"Done – {closed} window(s) closed.")


@cli.command("follow-up")
@click.option("-t", "--title", "session_title", type=str, help="Session title.")
@click.option("-m", "--prompt-text", type=str, help="Prompt text for follow-up.")
@click.option("-s", "--stdin", is_flag=True, help="Read prompt from STDIN.")
@click.option(
    "--gui-prompt/--no-gui-prompt",
    default=False,
    show_default=True,
    help="Show GUI dialog for missing fields (default: off)",
)
def cmd_follow_up(
    session_title: str | None, prompt_text: str | None, stdin: bool, gui_prompt: bool
) -> None:
    """Send a follow-up prompt to every provider tab in the session."""
    prune_stale_sessions_sync()
    from llm_burst.state import StateManager

    state = StateManager()

    # Read prompt text from STDIN if requested
    if stdin:
        prompt_text = sys.stdin.read()

    # Get active sessions (after pruning)
    active_sessions = list(state.list_sessions().keys())

    if not active_sessions:
        raise click.ClickException("No active sessions.")

    # If a specific title was provided via CLI, validate it first
    if session_title and session_title not in active_sessions:
        raise click.ClickException(f"Session '{session_title}' not found or inactive.")

    # Auto-select if only one session is active and no title was provided
    if session_title is None and len(active_sessions) == 1:
        session_title = active_sessions[0]

    need_dialog = (session_title is None) or (prompt_text is None)

    if need_dialog:
        # Determine which sessions to display in the dialog for selection
        # If we already have a session_title (either auto-selected or provided),
        # we show it as the only option (pre-selected). Otherwise, show all options.
        dialog_sessions = [session_title] if session_title else active_sessions

        # Show the dialog
        data = prompt_user(gui=gui_prompt, active_sessions=dialog_sessions)

        # Extract results
        session_title = data.get("Selected Session") or session_title
        prompt_text = data.get("Prompt Text") or data.get("prompt") or prompt_text

    # Final validation
    if session_title is None:
        # This should ideally not happen if the dialog works correctly
        raise click.UsageError("Session title is required.")

    sess = state.get_session(session_title)
    if sess is None:
        # Final check just in case (e.g. if session closed between dialog and here)
        raise click.ClickException(f"Session '{session_title}' not found.")

    if not prompt_text or not prompt_text.strip():
        raise click.UsageError("Prompt text is required.")

    # Import here to avoid top-level import churn
    from llm_burst.cli import send_prompt_by_target_sync

    for prov, tab in sess.tabs.items():
        try:
            send_prompt_by_target_sync(
                prov,  # provider
                tab.tab_id,  # target_id
                prompt_text,  # prompt
                follow_up=True,
            )
        except RuntimeError as exc:
            click.echo(f"{prov.name}: {exc}", err=True)

    click.echo("Follow-up sent to all provider tabs.")


@cli.command("arrange")
@click.option(
    "-m",
    "--max-windows",
    type=click.IntRange(1, 6),
    default=4,
    show_default=True,
    help="Maximum number of windows to arrange.",
)
@click.option(
    "-l",
    "--layout",
    type=click.Choice(["cdp", "none"], case_sensitive=False),
    default=lambda: os.getenv("LLM_BURST_LAYOUT", "cdp"),
    show_default=True,
    help="Window arrangement strategy.",
)
def cmd_arrange(max_windows: int, layout: str) -> None:
    """Arrange ungrouped LLM windows into a grid via Chrome CDP."""
    prune_stale_sessions_sync()
    if layout.lower() == "none":
        click.echo("Layout disabled (layout=none). Skipping arrangement.")
        return
    try:
        from llm_burst.layout import arrange

        arrange(max_windows)
        click.echo("Windows arranged.")
    except RuntimeError as exc:
        raise click.ClickException(str(exc)) from exc


@cli.command("toggle-group")
@click.option("-t", "--title", "session_title", type=str, help="Session title.")
def cmd_toggle_group(session_title: str | None) -> None:
    """Group or ungroup the Chrome tabs of *session_title*."""
    from llm_burst.state import StateManager

    state = StateManager()

    if session_title is None:
        sessions = list(state.list_sessions().keys())
        if not sessions:
            raise click.ClickException("No active sessions.")
        if len(sessions) > 1:
            raise click.ClickException("Multiple sessions active – specify --title.")
        session_title = sessions[0]

    sess = state.get_session(session_title)
    if sess is None:
        raise click.ClickException(f"Unknown session '{session_title}'")

    # Import helpers locally
    from llm_burst.tab_groups import move_target_to_group_sync, ungroup_target_sync

    group_name = f"{session_title} Group"
    try:
        if sess.grouped:
            # Remove each tab from its group
            for _, th in sess.tabs.items():
                ungroup_target_sync(th.tab_id)
            state.set_grouped(session_title, False)
            click.echo(f"Session '{session_title}' un-grouped.")
        else:
            # Add each tab to the group, creating it if necessary
            for prov, th in sess.tabs.items():
                move_target_to_group_sync(prov, th.tab_id, th.window_id, group_name)
            state.set_grouped(session_title, True)
            click.echo(f"Session '{session_title}' grouped.")
    except RuntimeError as exc:
        raise click.ClickException(str(exc)) from exc


@cli.group("group")
def group_commands() -> None:
    """Manage Chrome tab groups."""
    pass


@group_commands.command("list")
def cmd_group_list() -> None:
    """List all known tab groups."""
    groups = list_groups_sync()
    if not groups:
        click.echo("No tab groups defined.")
        return
    click.echo(f"{'ID':>5}  {'Name':20}  Colour")
    click.echo("-" * 35)
    for gid, grp in groups.items():
        click.echo(f"{gid:>5}  {grp.name:20}  {grp.color}")


@group_commands.command("create")
@click.argument("name")
@click.option(
    "-c",
    "--color",
    type=click.Choice([c.value for c in TabColor]),
    default=TabColor.GREY.value,
    show_default=True,
    help="Tab colour.",
)
def cmd_group_create(name: str, color: str) -> None:
    """Create a new Chrome tab group."""
    grp = create_group_sync(name, color)
    click.echo(f"Group '{grp.name}' (id={grp.group_id}) ready.")


@group_commands.command("move")
@click.argument("task_name")
@click.argument("group_name")
def cmd_group_move(task_name: str, group_name: str) -> None:
    """Move an existing task/tab into *group_name*."""
    try:
        move_to_group_sync(task_name, group_name)
        click.echo(f"Moved '{task_name}' → '{group_name}'.")
    except RuntimeError as exc:
        raise click.ClickException(str(exc)) from exc


@cli.command("chrome-status")
def cmd_chrome_status() -> None:
    """Display whether Chrome is running and if remote debugging is enabled.

    Exit status:
        0 → Chrome is running with --remote-debugging-port
        1 → Chrome not running or missing the flag
    """
    import sys
    from llm_burst.constants import CHROME_PROCESS_NAMES
    from llm_burst.chrome_utils import scan_chrome_processes

    status = scan_chrome_processes(CHROME_PROCESS_NAMES)

    click.echo(f"Chrome running       : {'Yes' if status.running else 'No'}")
    click.echo(f"Remote debugging flag: {'Yes' if status.remote_debug else 'No'}")
    if status.remote_debug:
        click.echo(f"Remote debugging port: {status.debug_port or '(unspecified)'}")
    click.echo(f"PIDs                 : {', '.join(map(str, status.pids)) or '-'}")

    # Exit 0 only when Chrome is running with the flag; 1 otherwise
    if not status.running or (status.running and not status.remote_debug):
        sys.exit(1)


@cli.command("chrome-launch")
def cmd_chrome_launch() -> None:
    """Force-quit any running Chrome instance and relaunch with remote debugging."""
    import click
    from pathlib import Path
    from llm_burst.constants import (
        CHROME_PROCESS_NAMES,
        CHROME_REMOTE_PORT,
    )
    from llm_burst.chrome_utils import (
        scan_chrome_processes,
        quit_chrome,
        get_chrome_profile_dir,
        launch_chrome_headful,
    )

    status = scan_chrome_processes(CHROME_PROCESS_NAMES)

    if status.running:
        click.echo("Quitting existing Chrome instance…")
        if quit_chrome(status.pids):
            click.echo("✓ Chrome exited")
        else:
            click.echo("⚠️  Failed to quit Chrome – attempting to continue", err=True)

    click.echo("Launching Chrome with --remote-debugging-port…")
    profile_dir = get_chrome_profile_dir()
    launch_chrome_headful(CHROME_REMOTE_PORT, Path(profile_dir))
    click.echo(f"✓ Chrome launched and listening on port {CHROME_REMOTE_PORT}")
