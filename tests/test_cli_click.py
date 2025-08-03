"""
Tests for Stage 3 Click CLI functionality.
"""

import json
from unittest.mock import patch, Mock, MagicMock

import pytest
from click.testing import CliRunner

from llm_burst.cli_click import cli
from llm_burst.constants import LLMProvider


@pytest.fixture
def runner():
    """Create a Click test runner."""
    return CliRunner()


def test_cli_help(runner):
    """Test that help message works."""
    result = runner.invoke(cli, ["--help"])
    assert result.exit_code == 0
    assert "llm-burst" in result.output
    assert "Commands:" in result.output


def test_list_command_empty(runner):
    """Test list command with no sessions."""
    with patch("llm_burst.cli_click.get_running_sessions", return_value={}):
        result = runner.invoke(cli, ["list"])
        assert result.exit_code == 0
        assert "No active sessions" in result.output


def test_list_command_with_sessions(runner):
    """Test list command with active sessions."""
    mock_sessions = {
        "Test-Task-1": {
            "provider": "CLAUDE",
            "target_id": "target-123",
            "window_id": 999,
        },
        "Test-Task-2": {
            "provider": "GEMINI",
            "target_id": "target-456",
            "window_id": 888,
        },
    }
    with patch("llm_burst.cli_click.get_running_sessions", return_value=mock_sessions):
        result = runner.invoke(cli, ["list"])
        assert result.exit_code == 0
        assert "Test-Task-1" in result.output
        assert "CLAUDE" in result.output
        assert "Test-Task-2" in result.output
        assert "GEMINI" in result.output


def test_list_command_json_output(runner):
    """Test list command with JSON output."""
    mock_sessions = {"Test": {"provider": "GROK", "target_id": "t1", "window_id": 1}}
    with patch("llm_burst.cli_click.get_running_sessions", return_value=mock_sessions):
        result = runner.invoke(cli, ["list", "--output", "json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["Test"]["provider"] == "GROK"


def test_open_command_with_all_args(runner):
    """Test open command with all arguments provided."""
    mock_handle = Mock()
    mock_handle.live.task_name = "Test-Task"
    with patch("llm_burst.cli_click.open_llm_window", return_value=mock_handle):
        with patch("llm_burst.cli_click.send_prompt_sync") as mock_send:
            result = runner.invoke(
                cli,
                [
                    "open",
                    "--provider", "claude",
                    "--task-name", "Test-Task",
                    "--prompt-text", "Hello AI",
                ],
            )
            assert result.exit_code == 0
            assert "Opened window 'Test-Task'" in result.output
            assert "CLAUDE" in result.output
            mock_send.assert_called_once_with(mock_handle, "Hello AI")


def test_open_command_with_dialog(runner):
    """Test open command that prompts for missing values."""
    mock_user_data = {
        "provider": "gemini",
        "task_name": "Dialog-Task",
        "prompt_text": "From dialog",
    }
    mock_handle = Mock()
    mock_handle.live.task_name = "Dialog-Task"
    
    with patch("llm_burst.cli_click.prompt_user", return_value=mock_user_data):
        with patch("llm_burst.cli_click.open_llm_window", return_value=mock_handle):
            with patch("llm_burst.cli_click.send_prompt_sync"):
                result = runner.invoke(cli, ["open"])
                assert result.exit_code == 0
                assert "Dialog-Task" in result.output


def test_open_command_stdin(runner):
    """Test open command reading from stdin."""
    mock_handle = Mock()
    mock_handle.live.task_name = "Stdin-Task"
    stdin_text = "This is from stdin"
    
    with patch("llm_burst.cli_click.open_llm_window", return_value=mock_handle):
        with patch("llm_burst.cli_click.send_prompt_sync") as mock_send:
            result = runner.invoke(
                cli,
                [
                    "open",
                    "-p", "chatgpt",
                    "-t", "Stdin-Task",
                    "--stdin",
                ],
                input=stdin_text,
            )
            assert result.exit_code == 0
            mock_send.assert_called_once_with(mock_handle, stdin_text)


def test_stop_command_single(runner):
    """Test stop command with single task."""
    with patch("llm_burst.cli_click.close_llm_window_sync", return_value=True):
        result = runner.invoke(cli, ["stop", "-t", "Task-1"])
        assert result.exit_code == 0
        assert "Closed 'Task-1'" in result.output
        assert "1 window(s) closed" in result.output


def test_stop_command_multiple(runner):
    """Test stop command with multiple tasks."""
    with patch("llm_burst.cli_click.close_llm_window_sync", side_effect=[True, False, True]):
        result = runner.invoke(cli, ["stop", "-t", "T1", "-t", "T2", "-t", "T3"])
        assert result.exit_code == 0
        assert "Closed 'T1'" in result.output
        assert "No active window for 'T2'" in result.output
        assert "Closed 'T3'" in result.output
        assert "2 window(s) closed" in result.output


def test_stop_command_all(runner):
    """Test stop command with --all flag."""
    mock_sessions = {"Task-A": {}, "Task-B": {}}
    with patch("llm_burst.cli_click.get_running_sessions", return_value=mock_sessions):
        with patch("llm_burst.cli_click.close_llm_window_sync", return_value=True):
            result = runner.invoke(cli, ["stop", "--all"])
            assert result.exit_code == 0
            assert "2 window(s) closed" in result.output


def test_stop_command_no_args(runner):
    """Test stop command without arguments."""
    result = runner.invoke(cli, ["stop"])
    assert result.exit_code != 0
    assert "Provide --task-name or --all" in result.output