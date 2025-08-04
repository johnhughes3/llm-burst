"""
Tests for Stage-6 window arrangement functionality.

Tests verify that the arrange command:
- Properly invokes Rectangle.app actions
- Only arranges ungrouped sessions
- Respects max_windows parameter
- Handles edge cases gracefully
"""

import pytest
from unittest.mock import patch, call

from llm_burst.constants import LLMProvider, RectangleAction
from llm_burst.state import StateManager
from llm_burst.layout import arrange

pytestmark = pytest.mark.unit


@pytest.fixture
def temp_state_file(tmp_path):
    """Create a temporary state file for testing."""
    state_file = tmp_path / "test_state.json"
    with patch("llm_burst.state.STATE_FILE", state_file):
        # Clear singleton to force reload with test path
        StateManager._instance = None
        yield state_file
        StateManager._instance = None


def test_arrange_no_sessions(temp_state_file):
    """Test arrange with no active sessions."""
    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        arrange()
        # Should not call rectangle_perform when no sessions
        mock_perform.assert_not_called()


def test_arrange_two_windows(temp_state_file):
    """Test arranging two ungrouped windows."""
    # Setup state with two ungrouped sessions
    state = StateManager()
    state.register("Task-1", LLMProvider.CLAUDE, "target-1", 100)
    state.register("Task-2", LLMProvider.GEMINI, "target-2", 200)

    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        with patch("llm_burst.layout._focus_window") as mock_focus:
            with patch("time.sleep"):  # Skip delays in tests
                arrange()

                # Should focus both windows in order
                assert mock_focus.call_count == 2
                mock_focus.assert_has_calls(
                    [
                        call(100),  # First window (lower ID)
                        call(200),  # Second window
                    ]
                )

                # Should apply left/right layout
                assert mock_perform.call_count == 2
                mock_perform.assert_has_calls(
                    [
                        call(RectangleAction.LEFT_HALF),
                        call(RectangleAction.RIGHT_HALF),
                    ]
                )


def test_arrange_four_windows(temp_state_file):
    """Test arranging four ungrouped windows."""
    state = StateManager()
    state.register("Task-1", LLMProvider.CLAUDE, "t1", 400)
    state.register("Task-2", LLMProvider.GEMINI, "t2", 300)
    state.register("Task-3", LLMProvider.CHATGPT, "t3", 200)
    state.register("Task-4", LLMProvider.GROK, "t4", 100)

    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        with patch("llm_burst.layout._focus_window") as mock_focus:
            with patch("time.sleep"):
                arrange()

                # Should focus all four windows in ID order
                assert mock_focus.call_count == 4
                mock_focus.assert_has_calls(
                    [
                        call(100),  # Lowest ID first
                        call(200),
                        call(300),
                        call(400),
                    ]
                )

                # Should apply 4-quadrant layout
                assert mock_perform.call_count == 4
                mock_perform.assert_has_calls(
                    [
                        call(RectangleAction.UPPER_LEFT),
                        call(RectangleAction.UPPER_RIGHT),
                        call(RectangleAction.LOWER_LEFT),
                        call(RectangleAction.LOWER_RIGHT),
                    ]
                )


def test_arrange_skips_grouped_sessions(temp_state_file):
    """Test that arrange skips sessions in a tab group."""
    state = StateManager()
    # Clear any leftover sessions from previous tests
    for task_name in list(state.list_all().keys()):
        state.remove(task_name)

    # Two ungrouped sessions
    state.register("Ungrouped-1", LLMProvider.CLAUDE, "t1", 100)
    state.register("Ungrouped-2", LLMProvider.GEMINI, "t2", 200)
    # Two grouped sessions (should be ignored)
    state.register("Grouped-1", LLMProvider.CHATGPT, "t3", 300, group_id=999)
    state.register("Grouped-2", LLMProvider.GROK, "t4", 400, group_id=999)

    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        with patch("llm_burst.layout._focus_window") as mock_focus:
            with patch("time.sleep"):
                arrange()

                # Should only arrange the two ungrouped windows
                assert mock_focus.call_count == 2
                assert mock_perform.call_count == 2

                # Should not touch grouped windows (300, 400)
                mock_focus.assert_has_calls(
                    [
                        call(100),
                        call(200),
                    ]
                )


def test_arrange_respects_max_windows(temp_state_file):
    """Test that arrange respects the max_windows parameter."""
    state = StateManager()
    # Create 5 sessions
    for i in range(5):
        state.register(f"Task-{i}", LLMProvider.CLAUDE, f"t{i}", 100 + i)

    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        with patch("llm_burst.layout._focus_window") as mock_focus:
            with patch("time.sleep"):
                # Limit to 3 windows
                arrange(max_windows=3)

                # Should only arrange 3 windows
                assert mock_focus.call_count == 3
                assert mock_perform.call_count == 3

                # Should use 3-window layout
                mock_perform.assert_has_calls(
                    [
                        call(RectangleAction.LEFT_HALF),
                        call(RectangleAction.UPPER_RIGHT),
                        call(RectangleAction.LOWER_RIGHT),
                    ]
                )


def test_arrange_handles_rectangle_error(temp_state_file):
    """Test that arrange handles Rectangle errors gracefully."""
    state = StateManager()
    state.register("Task-1", LLMProvider.CLAUDE, "t1", 100)

    with patch("llm_burst.layout.rectangle_perform") as mock_perform:
        mock_perform.side_effect = RuntimeError("Rectangle not installed")
        with patch("llm_burst.layout._focus_window"):
            with patch("time.sleep"):
                with pytest.raises(RuntimeError, match="Rectangle not installed"):
                    arrange()


def test_cli_arrange_command():
    """Test the CLI arrange command."""
    from llm_burst.cli_click import cli
    from click.testing import CliRunner

    runner = CliRunner()

    with patch("llm_burst.layout.arrange") as mock_arrange:
        result = runner.invoke(cli, ["arrange", "--max-windows", "3"])

        assert result.exit_code == 0
        assert "Windows arranged" in result.output
        mock_arrange.assert_called_once_with(3)


def test_cli_arrange_error_handling():
    """Test CLI arrange command error handling."""
    from llm_burst.cli_click import cli
    from click.testing import CliRunner

    runner = CliRunner()

    with patch("llm_burst.layout.arrange") as mock_arrange:
        mock_arrange.side_effect = RuntimeError("Test error")
        result = runner.invoke(cli, ["arrange"])

        assert result.exit_code != 0
        assert "Test error" in result.output
