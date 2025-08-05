"""
llm_burst.cli_click
-------------------

Stage-3: User-facing Click command-line interface.

Commands
--------
list   : Show running sessions
open   : Open (or reuse) an LLM window and optionally send a prompt
stop   : Close one or more running sessions
arrange: Tile active windows with Rectangle.app
"""

from __future__ import annotations

import json
import logging
import sys
import asyncio
import subprocess
from importlib import metadata
from typing import Optional

import click

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
)

_LOG = logging.getLogger(__name__)


def _task_slug(session_title: str, provider: LLMProvider) -> str:
    """Internal: unique task name used for each provider tab."""
    return f"{session_title}:{provider.name.lower()}"


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
    sessions = get_running_sessions()

    if output == "json":
        click.echo(json.dumps(sessions, indent=2))
        return

    # Table view
    if not sessions:
        click.echo("No active sessions.")
        return
    header = f"{'Task':30}  {'Provider':10}  TargetID / WindowID"
    click.echo(header)
    click.echo("-" * len(header))
    for task, info in sessions.items():
        click.echo(
            f"{task:30}  {info['provider']:10}  {info['target_id']} / {info['window_id']}"
        )


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
    "-r",
    "--reuse",
    is_flag=True,
    help="Fail if *task-name* already exists instead of re-creating.",
)
@click.option(
    "-g",
    "--group",
    "group_name",
    type=str,
    help="Chrome tab-group name.",
)
def cmd_open(
    provider: Optional[str],
    task_name: Optional[str],
    prompt_text: Optional[str],
    stdin: bool,
    reuse: bool,
    group_name: Optional[str],
) -> None:
    """Open a new LLM window (or re-attach) and optionally send a prompt."""
    from llm_burst.chrome_bootstrap import ensure_remote_debugging  # Added
    ensure_remote_debugging()  # Added

    # Merge missing values from swiftDialog prompt when any field absent
    if (
        provider is None
        or (task_name is None and not reuse)
        or (prompt_text is None and not stdin)
    ):
        user_data = prompt_user()
        provider = provider or user_data.get("provider")
        task_name = task_name or user_data.get("task_name") or user_data.get("task")
        prompt_text = (
            prompt_text or user_data.get("prompt_text") or user_data.get("prompt")
        )

    # Validation
    if provider is None:
        raise click.UsageError("provider is required")

    if reuse and task_name is None:
        raise click.UsageError("--reuse requires --task-name")

    provider_enum = _provider_from_str(provider)

    from llm_burst.state import StateManager

    state = StateManager()
    if reuse and task_name in state.list_all():
        raise click.ClickException(
            f"Session '{task_name}' already exists (reuse flag set)."
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
def cmd_activate(
    session_title: str | None,
    prompt_text: str | None,
    stdin: bool,
    research: bool,
    incognito: bool,
) -> None:
    """Open 4 LLM tabs and send the same prompt (⌃⌥R replacement)."""
    from llm_burst.chrome_bootstrap import ensure_remote_debugging  # Added
    ensure_remote_debugging()  # Added

    from datetime import datetime
    from llm_burst.state import StateManager
    from llm_burst.browser import BrowserAdapter

    # 1️⃣ Gather any missing fields from swiftDialog
    if prompt_text is None and not stdin:
        try:
            data = prompt_user()
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
        prompt_text = sys.stdin.read()

    if prompt_text is None or not prompt_text.strip():
        raise click.UsageError(
            "Prompt text required (via --prompt-text, --stdin, or dialog)"
        )

    providers = list(LLMProvider)  # All known providers for now

    async def _async_activate() -> tuple[list[str], str]:
        """Open all provider windows and send prompt while BrowserAdapter is alive."""
        # Late import so test patches are honoured
        from llm_burst.auto_namer import auto_name_session
        
        opened: list[str] = []
        state = StateManager()
        final_title = session_title  # May change after rename
        first_renamed: str | None = None

        # Create or reuse the session record
        if state.get_session(session_title):
            click.echo(f"Re-using existing session '{session_title}'")
        else:
            state.create_session(session_title)

        async with BrowserAdapter() as adapter:
            for prov in providers:
                task = _task_slug(session_title, prov)
                try:
                    handle = await adapter.open_window(task, prov)
                    opts = InjectOptions(
                        follow_up=False,
                        research=research,
                        incognito=incognito,
                    )
                    injector = get_injector(prov)
                    await injector(handle.page, prompt_text, opts)

                    # Attempt auto-naming for this tab
                    new_task_name = await auto_name_session(handle.live, handle.page)
                    if new_task_name and first_renamed is None:
                        first_renamed = new_task_name

                    state.add_tab_to_session(
                        session_title,
                        prov,
                        handle.live.window_id,
                        handle.live.target_id,
                    )
                    opened.append(prov.name.lower())
                except Exception as exc:
                    click.echo(f"Failed to open {prov.name}: {exc}", err=True)

            # If we used an auto-generated session title, try to improve it
            if auto_generated and first_renamed:
                candidate_title = first_renamed.split(":", 1)[0]
                if state.rename_session(final_title, candidate_title):
                    final_title = candidate_title

            # Flush state so that follow-up commands see the new data
            state.persist_now()
            return opened, final_title

    opened, session_title = asyncio.run(_async_activate())

    click.echo(f"✓ Session '{session_title}' activated with {len(opened)} provider(s)")

    # Arrange windows unless research mode is requested
    if not research and len(opened) > 1:
        try:
            from llm_burst.layout import arrange

            arrange(len(opened))
            click.echo("✓ Windows arranged")
        except Exception:
            # Best-effort only
            pass


# --------------------------------------------------------------------------- #
# stop command                                                                #
# --------------------------------------------------------------------------- #


@cli.command("stop")
@click.option("-t", "--task-name", "task_names", multiple=True, help="Task(s) to stop.")
@click.option("-a", "--all", "stop_all", is_flag=True, help="Stop all sessions.")
def cmd_stop(task_names: tuple[str, ...], stop_all: bool) -> None:
    """Close one or more running LLM windows."""
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
def cmd_follow_up(
    session_title: str | None, prompt_text: str | None, stdin: bool
) -> None:
    """Send a follow-up prompt to every provider tab in the session."""
    from llm_burst.state import StateManager

    state = StateManager()

    # Auto-select session when only one exists, or prompt for selection
    if session_title is None:
        sessions = list(state.list_sessions().keys())
        if not sessions:
            raise click.ClickException("No active sessions.")
        if len(sessions) > 1:
            # Interactive selection when multiple sessions exist
            click.echo("Multiple active sessions:")
            for i, session in enumerate(sessions, 1):
                click.echo(f"  {i}. {session}")

            # Prompt user to select
            while True:
                try:
                    choice = click.prompt(
                        "Select session number",
                        type=click.IntRange(1, len(sessions)),
                        show_choices=True,
                    )
                    session_title = sessions[choice - 1]
                    break
                except (click.BadParameter, click.Abort) as e:
                    if isinstance(e, click.Abort):
                        raise  # Re-raise abort (Ctrl+C)
                    click.echo("Invalid selection. Please try again.")
        else:
            session_title = sessions[0]

    sess = state.get_session(session_title)
    if sess is None:
        raise click.ClickException(f"Session '{session_title}' not found.")

    if stdin:
        prompt_text = sys.stdin.read()
    if prompt_text is None:
        data = prompt_user()
        prompt_text = data.get("Prompt Text") or data.get("prompt")
    if not prompt_text or not prompt_text.strip():
        raise click.UsageError("Prompt text is required.")

    for prov in sess.tabs.keys():
        task = _task_slug(session_title, prov)
        try:
            send_prompt_sync(task, prompt_text, follow_up=True)
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
def cmd_arrange(max_windows: int) -> None:
    """Arrange ungrouped LLM windows into a grid via Rectangle.app."""
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

    group_name = f"{session_title} Group"
    try:
        if sess.grouped:
            # Ungroup ➜ special helper removes from group
            for prov in sess.tabs:
                move_to_group_sync(_task_slug(session_title, prov), "_ungroup_")
            state.set_grouped(session_title, False)
            click.echo(f"Session '{session_title}' un-grouped.")
        else:
            for prov in sess.tabs:
                move_to_group_sync(_task_slug(session_title, prov), group_name)
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
    click.echo(f"PIDs                 : {', '.join(map(str, status.pids)) or '-'}")

    # Non-zero exit when debugging flag is missing while Chrome is up
    if status.running and not status.remote_debug:
        sys.exit(1)


@cli.command("chrome-launch")
def cmd_chrome_launch() -> None:
    """Force-quit any running Chrome instance and relaunch with remote debugging."""
    import click
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
    launch_chrome_headful(CHROME_REMOTE_PORT, profile_dir)
    click.echo("✓ Chrome launched and listening on port "
               f"{CHROME_REMOTE_PORT}")
