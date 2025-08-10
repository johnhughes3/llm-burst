"""
Test auto-naming functionality in activate command.

Tests:
- Auto-name session is called for each provider tab
- Session title is renamed when auto-generated
- StateManager.rename_session works correctly
"""

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from llm_burst.state import StateManager
from llm_burst.constants import LLMProvider


class TestStateManagerRename:
    """Test StateManager.rename_session functionality."""

    def setup_method(self):
        """Clear StateManager singleton and use temp file for each test."""
        StateManager._instance = None
        # Create a temporary state file for testing
        self.temp_dir = tempfile.mkdtemp()
        self.temp_state = Path(self.temp_dir) / "test_state.json"

    def teardown_method(self):
        """Clean up temp files."""
        import shutil

        if hasattr(self, "temp_dir"):
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_rename_session_success(self):
        """Test successful session rename."""
        state = StateManager(state_file=self.temp_state)

        # Create a session
        state.create_session("old_title")

        # Rename it
        result = state.rename_session("old_title", "new_title")
        assert result is True

        # Check it was renamed
        assert state.get_session("new_title") is not None
        assert state.get_session("old_title") is None

    def test_rename_session_not_found(self):
        """Test rename fails when session doesn't exist."""
        state = StateManager(state_file=self.temp_state)

        result = state.rename_session("non_existent", "new_title")
        assert result is False

    def test_rename_session_collision(self):
        """Test rename fails when new name already exists."""
        state = StateManager(state_file=self.temp_state)

        # Create two sessions
        state.create_session("session1")
        state.create_session("session2")

        # Try to rename session1 to session2
        result = state.rename_session("session1", "session2")
        assert result is False

        # Both should still exist with original names
        assert state.get_session("session1") is not None
        assert state.get_session("session2") is not None


class TestActivateAutoNaming:
    """Test auto-naming in activate command."""

    def setup_method(self):
        """Clear StateManager singleton before each test."""
        StateManager._instance = None

    @patch("llm_burst.browser.BrowserAdapter")
    @patch("llm_burst.auto_namer.auto_name_session", new_callable=AsyncMock)
    @patch("llm_burst.cli_click.get_injector")
    def test_auto_naming_called(self, mock_injector, mock_auto_name, mock_adapter):
        """Test that auto_name_session is called for each provider."""
        from llm_burst.cli_click import cmd_activate
        from click.testing import CliRunner

        # Setup mocks
        mock_adapter_instance = AsyncMock()
        mock_adapter.return_value.__aenter__.return_value = mock_adapter_instance

        mock_page = AsyncMock()
        mock_handle = MagicMock()
        mock_handle.page = mock_page
        mock_handle.live.window_id = 123
        mock_handle.live.target_id = "456"
        mock_handle.live.task_name = "test"

        mock_adapter_instance.open_window.return_value = mock_handle
        mock_injector.return_value = AsyncMock()
        mock_auto_name.return_value = None  # No rename

        runner = CliRunner()
        runner.invoke(cmd_activate, ["--prompt-text", "test prompt"])

        # Auto-name should be called for each provider
        assert mock_auto_name.call_count == len(LLMProvider)

    @patch("llm_burst.browser.BrowserAdapter")
    @patch("llm_burst.auto_namer.auto_name_session", new_callable=AsyncMock)
    @patch("llm_burst.cli_click.get_injector")
    @patch("llm_burst.state.StateManager")
    @patch("llm_burst.cli_click.prompt_user")
    def test_session_renamed_when_auto_generated(
        self,
        mock_prompt_user,
        mock_state_class,
        mock_injector,
        mock_auto_name,
        mock_adapter,
    ):
        """Test that session is renamed when title was auto-generated."""
        from llm_burst.cli_click import cmd_activate
        from click.testing import CliRunner

        # Mock prompt_user to return dummy data
        mock_prompt_user.return_value = {
            "Task Name": None,  # No title provided, will auto-generate
            "Prompt Text": "test prompt",
        }

        # Setup state mock - make sure the class returns our mock instance
        mock_state = MagicMock()
        mock_state_class.return_value = mock_state
        mock_state.get_session.return_value = None
        mock_state.create_session = MagicMock()  # Add this
        mock_state.add_tab_to_session = MagicMock()  # Add this
        mock_state.persist_now = MagicMock()  # Add this
        mock_state.rename_session.return_value = True

        # Setup adapter mock
        mock_adapter_instance = AsyncMock()
        mock_adapter.return_value.__aenter__.return_value = mock_adapter_instance

        mock_page = AsyncMock()
        mock_handle = MagicMock()
        mock_handle.page = mock_page
        mock_handle.live.window_id = 123
        mock_handle.live.target_id = "456"
        mock_handle.live.task_name = "test"

        mock_adapter_instance.open_window.return_value = mock_handle
        mock_injector.return_value = AsyncMock()

        # First provider gets renamed
        mock_auto_name.side_effect = [
            "Better Name:gemini",  # First call returns a rename
            None,  # Others return None
            None,
            None,
        ]

        runner = CliRunner()

        # Don't provide --prompt-text, let it come from mock_prompt_user
        runner.invoke(cmd_activate, [])

        # rename_session should have been called
        mock_state.rename_session.assert_called_once()

        # The new name should be derived from the renamed tab
        call_args = mock_state.rename_session.call_args[0]
        assert call_args[1] == "Better Name"  # Second arg is new name

    def test_timestamp_format(self):
        """Test that auto-generated title has correct format."""
        # The format should match: "%a, %b %d, %Y %I:%M%p"
        now = datetime.now()
        expected_format = now.strftime("%a, %b %d, %Y %I:%M%p")

        # Check it matches expected pattern
        import re

        pattern = r"^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2}[AP]M$"
        assert re.match(pattern, expected_format)
