"""
Tests for Stage-6 window arrangement functionality (CDP-only).

Tests verify that the arrange command:
- Invokes CDP arrangement helper
- Respects max_windows parameter
- Handles edge cases gracefully
"""

import pytest
from unittest.mock import patch

from llm_burst.layout import arrange

pytestmark = pytest.mark.unit


@pytest.fixture
def temp_state_file(tmp_path):
    """Create a temporary state file for testing."""
    from llm_burst.state import StateManager

    state_file = tmp_path / "test_state.json"
    with patch("llm_burst.state.STATE_FILE", state_file):
        StateManager._instance = None
        yield state_file
        StateManager._instance = None


def test_arrange_invokes_cdp_with_default_max(temp_state_file):
    """arrange() calls the CDP arrange helper with default max_windows=4."""
    with patch("llm_burst.layout_manual.arrange_cdp_sync") as mock_cdp:
        arrange()
        mock_cdp.assert_called_once_with(4)


def test_arrange_invokes_cdp_with_custom_max(temp_state_file):
    """arrange(max_windows) forwards the parameter to the CDP helper."""
    with patch("llm_burst.layout_manual.arrange_cdp_sync") as mock_cdp:
        arrange(max_windows=3)
        mock_cdp.assert_called_once_with(3)


def test_arrange_handles_cdp_error(temp_state_file):
    """arrange() logs errors from CDP helper but does not raise."""
    with patch("llm_burst.layout_manual.arrange_cdp_sync") as mock_cdp:
        mock_cdp.side_effect = RuntimeError("CDP failed")
        # Should not raise
        arrange()


def test_arrange_command_cli_runs_and_calls_arrange():
    """CLI arrange command runs and calls arrange with provided max windows."""
    from llm_burst.cli_click import cli
    from click.testing import CliRunner

    runner = CliRunner()
    with (
        patch("llm_burst.cli_click.prune_stale_sessions_sync", return_value=0),
        patch("llm_burst.layout.arrange") as mock_arrange,
    ):
        result = runner.invoke(cli, ["arrange", "--max-windows", "3"])
        assert result.exit_code == 0
        assert "Windows arranged" in result.output
        mock_arrange.assert_called_once_with(3)


def test_cli_arrange_error_handling():
    """Test CLI arrange command error handling."""
    from llm_burst.cli_click import cli
    from click.testing import CliRunner

    runner = CliRunner()

    with (
        patch("llm_burst.cli_click.prune_stale_sessions_sync", return_value=0),
        patch("llm_burst.layout.arrange") as mock_arrange,
    ):
        mock_arrange.side_effect = RuntimeError("Test error")
        result = runner.invoke(cli, ["arrange"])

        assert result.exit_code != 0
        assert "Test error" in result.output
