"""
Tests for the --tabs mode of activate, ensuring:
- First provider opens a new window
- Remaining providers open as tabs in the same window
- Group is created and state updated as grouped
"""

from unittest.mock import AsyncMock, MagicMock, patch
from click.testing import CliRunner

from llm_burst.cli_click import cmd_activate
from llm_burst.constants import LLMProvider


@patch("llm_burst.cli_click.get_injector")
@patch("llm_burst.browser.BrowserAdapter")
@patch("llm_burst.cli_click.StateManager")
def test_activate_tabs_mode_groups_and_opens_tabs(mock_state_cls, mock_adapter_cls, mock_get_injector):
    # Mock StateManager instance
    mock_state = MagicMock()
    mock_state.get_session.return_value = None
    mock_state.create_session = MagicMock()
    mock_state.add_tab_to_session = MagicMock()
    mock_state.persist_now = MagicMock()
    mock_state.set_grouped = MagicMock()
    mock_state_cls.return_value = mock_state

    # Mock adapter async context
    mock_adapter = AsyncMock()
    mock_adapter_cls.return_value.__aenter__.return_value = mock_adapter

    # Mock first handle (new window)
    first_handle = MagicMock()
    first_handle.live.window_id = 123
    first_handle.live.target_id = "t-first"
    first_handle.live.task_name = "internal_gemini_0000"
    first_handle.live.provider = list(LLMProvider)[0]
    first_handle.page = AsyncMock()

    # Mock subsequent handles (tabs)
    tab_handles = []
    for prov in list(LLMProvider)[1:]:
        h = MagicMock()
        h.live.window_id = 123
        h.live.target_id = f"t-{prov.name.lower()}"
        h.live.task_name = f"internal_{prov.name.lower()}_0000"
        h.live.provider = prov
        h.page = AsyncMock()
        tab_handles.append(h)

    mock_adapter.open_window.return_value = first_handle
    mock_adapter.open_tab_in_window.side_effect = tab_handles

    # Mock group helpers
    mock_adapter._get_or_create_group.return_value = 999
    mock_adapter._add_target_to_group = AsyncMock()

    # Mock injector for prompt injection
    inj = AsyncMock()
    mock_get_injector.return_value = inj

    runner = CliRunner()
    with patch("llm_burst.cli_click.ensure_remote_debugging"):
        result = runner.invoke(
            cmd_activate, ["--prompt-text", "hello", "--tabs"], catch_exceptions=False
        )

    assert result.exit_code == 0
    # First provider opened as window
    mock_adapter.open_window.assert_called_once()
    # Others opened as tabs
    assert mock_adapter.open_tab_in_window.call_count == len(LLMProvider) - 1
    # Group created and state marked grouped
    mock_adapter._get_or_create_group.assert_called_once()
    mock_state.set_grouped.assert_called_once()
    # Prompts injected in each tab/window
    assert inj.await_count == len(LLMProvider)
