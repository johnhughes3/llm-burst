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

from llm_burst.constants import LLMProvider
from llm_burst.cli import (
    open_llm_window,
    send_prompt_sync,
    get_running_sessions,
    close_llm_window_sync,
    prompt_user,
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
def cmd_open(
    provider: Optional[str],
    task_name: Optional[str],
    prompt_text: Optional[str],
    stdin: bool,
    reuse: bool,
) -> None:
    """Open a new LLM window (or re-attach) and optionally send a prompt."""

    # Merge missing values from swiftDialog
    if provider is None or task_name is None or (prompt_text is None and not stdin):
        user_data = prompt_user()
        provider = provider or user_data.get("provider")
        task_name = task_name or user_data.get("task_name") or user_data.get("task")
        prompt_text = prompt_text or user_data.get("prompt_text") or user_data.get("prompt")

    if provider is None or task_name is None:
        raise click.UsageError("provider and task-name are required")

    provider_enum = _provider_from_str(provider)

    from llm_burst.state import StateManager

    state = StateManager()
    if reuse and task_name in state.list_all():
        raise click.ClickException(f"Session '{task_name}' already exists (reuse flag set).")

    if stdin:
        prompt_text = sys.stdin.read()

    handle = open_llm_window(task_name, provider_enum)
    click.echo(f"Opened window '{task_name}' → {provider_enum.name}")

    if prompt_text:
        send_prompt_sync(handle, prompt_text)
        click.echo("Prompt sent.")


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