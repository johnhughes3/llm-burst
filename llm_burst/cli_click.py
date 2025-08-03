"""
llm_burst.cli_click
-------------------

Stage-3: User-facing Click command-line interface.

Commands
--------
list   : Show running sessions
open   : Open (or reuse) an LLM window and optionally send a prompt
stop   : Close one or more running sessions
"""
from __future__ import annotations

import json
import logging
import sys
from importlib import metadata
from typing import Optional

import click

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
    auto_name_sync,   # Added
)

_LOG = logging.getLogger(__name__)


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

    # Merge missing values from swiftDialog prompt when any field absent
    if provider is None or (task_name is None and not reuse) or (prompt_text is None and not stdin):
        user_data = prompt_user()
        provider = provider or user_data.get("provider")
        task_name = task_name or user_data.get("task_name") or user_data.get("task")
        prompt_text = prompt_text or user_data.get("prompt_text") or user_data.get("prompt")

    # Validation
    if provider is None:
        raise click.UsageError("provider is required")

    if reuse and task_name is None:
        raise click.UsageError("--reuse requires --task-name")

    provider_enum = _provider_from_str(provider)

    from llm_burst.state import StateManager
    state = StateManager()
    if reuse and task_name in state.list_all():
        raise click.ClickException(f"Session '{task_name}' already exists (reuse flag set).")

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