"""
Tests for Stage 5 Chrome tab grouping functionality.
"""

from unittest.mock import Mock, patch, AsyncMock
import pytest

from llm_burst.constants import LLMProvider, TabColor, DEFAULT_PROVIDER_COLORS
from llm_burst.state import LiveSession, TabGroup, StateManager


@pytest.mark.unit
def test_tab_color_enum():
    """Test TabColor enum values."""
    assert TabColor.BLUE.value == "blue"
    assert TabColor.RED.value == "red"
    assert TabColor.GREY.value == "grey"
    assert len(TabColor) == 8  # 8 Chrome colors


@pytest.mark.unit
def test_default_provider_colors():
    """Test default color mappings for providers."""
    assert DEFAULT_PROVIDER_COLORS[LLMProvider.GEMINI] == TabColor.BLUE
    assert DEFAULT_PROVIDER_COLORS[LLMProvider.CLAUDE] == TabColor.YELLOW
    assert DEFAULT_PROVIDER_COLORS[LLMProvider.CHATGPT] == TabColor.GREEN
    assert DEFAULT_PROVIDER_COLORS[LLMProvider.GROK] == TabColor.RED


@pytest.mark.unit
def test_tab_group_dataclass():
    """Test TabGroup dataclass."""
    group = TabGroup(group_id=123, name="Research", color="blue")
    assert group.group_id == 123
    assert group.name == "Research"
    assert group.color == "blue"


@pytest.mark.unit
def test_live_session_with_group():
    """Test LiveSession with optional group_id."""
    session = LiveSession(
        task_name="Test",
        provider=LLMProvider.GEMINI,
        target_id="target-1",
        window_id=100,
        group_id=42,
    )
    assert session.group_id == 42

    # Test without group_id
    session2 = LiveSession(
        task_name="Test2",
        provider=LLMProvider.CLAUDE,
        target_id="target-2",
        window_id=101,
    )
    assert session2.group_id is None


@pytest.mark.unit
def test_state_manager_group_operations():
    """Test StateManager group management methods."""
    with patch("llm_burst.state.StateManager._instance", None):
        state = StateManager()

        # Test register_group
        with patch.object(state, "_persist"):
            group = state.register_group(1, "Research", "blue")
            assert group.group_id == 1
            assert group.name == "Research"
            assert group.color == "blue"
            assert 1 in state._groups

        # Test get_group_by_name
        found = state.get_group_by_name("Research")
        assert found is not None
        assert found.group_id == 1

        missing = state.get_group_by_name("NonExistent")
        assert missing is None

        # Test list_groups
        groups = state.list_groups()
        assert len(groups) == 1
        assert 1 in groups

        # Test assign_session_to_group
        session = LiveSession(
            task_name="Test-Task",
            provider=LLMProvider.GEMINI,
            target_id="target-1",
            window_id=100,
        )
        state._sessions["Test-Task"] = session

        with patch.object(state, "_persist"):
            state.assign_session_to_group("Test-Task", 1)
            assert session.group_id == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_browser_probe_tab_groups():
    """Test tab groups support detection."""
    from llm_burst.browser import BrowserAdapter

    adapter = BrowserAdapter()
    adapter._browser = Mock()

    mock_cdp = AsyncMock()

    with patch.object(BrowserAdapter, "_get_cdp_connection", AsyncMock(return_value=mock_cdp)):
        await adapter._probe_tab_groups()
        assert adapter._tab_groups_supported is True

    # Reset side-effect to simulate methodNotFound error
    adapter._tab_groups_supported = None
    mock_cdp.send.side_effect = Exception("methodNotFound")
    with patch.object(BrowserAdapter, "_get_cdp_connection", AsyncMock(return_value=mock_cdp)):
        await adapter._probe_tab_groups()
        assert adapter._tab_groups_supported is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_browser_get_or_create_group():
    """Test group creation via browser adapter."""
    from llm_burst.browser import BrowserAdapter

    adapter = BrowserAdapter()
    adapter._browser = Mock()
    adapter._tab_groups_supported = True

    mock_cdp = AsyncMock()
    mock_cdp.send.return_value = {"groupId": 42}

    with patch.object(BrowserAdapter, "_get_cdp_connection", AsyncMock(return_value=mock_cdp)):
        with patch.object(adapter._state, "get_group_by_name", return_value=None):
            with patch.object(adapter._state, "register_group") as mock_register:
                group_id = await adapter._get_or_create_group("Research", "blue", 100)

                assert group_id == 42
                mock_cdp.send.assert_called_once_with(
                    "TabGroups.create",
                    {"windowId": 100, "title": "Research", "color": "blue"},
                )
                mock_register.assert_called_once_with(42, "Research", "blue")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_browser_add_target_to_group():
    """Test adding a tab to a group."""
    from llm_burst.browser import BrowserAdapter

    adapter = BrowserAdapter()
    adapter._browser = Mock()
    adapter._tab_groups_supported = True

    mock_cdp = AsyncMock()
    with patch.object(BrowserAdapter, "_get_cdp_connection", AsyncMock(return_value=mock_cdp)):
        await adapter._add_target_to_group("target-123", 42)

    mock_cdp.send.assert_called_once_with(
        "TabGroups.addTab", {"groupId": 42, "tabId": "target-123"}
    )


@pytest.mark.unit
def test_tab_groups_sync_functions():
    """Test synchronous wrapper functions."""
    from llm_burst.tab_groups import (
        list_groups_sync,
    )

    # Test list_groups_sync
    with patch("llm_burst.tab_groups.StateManager") as MockState:
        mock_state = Mock()
        mock_state.list_groups.return_value = {1: Mock(name="Research")}
        MockState.return_value = mock_state

        groups = list_groups_sync()
        assert len(groups) == 1
        assert 1 in groups


@pytest.mark.unit
def test_cli_open_with_group():
    """Test CLI open command with --group option."""
    from click.testing import CliRunner
    from llm_burst.cli_click import cli

    runner = CliRunner()

    with patch("llm_burst.cli_click.open_llm_window") as mock_open:
        with patch("llm_burst.cli_click.move_to_group_sync") as mock_move:
            with patch("llm_burst.state.StateManager") as MockState:
                with patch("llm_burst.cli_click.send_prompt_sync"):
                    with patch(
                        "llm_burst.cli_click.prompt_user"
                    ):  # Mock prompt_user to prevent swiftDialog call
                        # Setup mocks
                        handle = Mock()
                        handle.live.task_name = "Test-Task"
                        mock_open.return_value = handle

                        mock_state = Mock()
                        mock_state.list_all.return_value = {}
                        MockState.return_value = mock_state

                        # Run command with --group
                        result = runner.invoke(
                            cli,
                            [
                                "open",
                                "-p",
                                "gemini",
                                "-t",
                                "Test-Task",
                                "--group",
                                "Research",
                            ],
                        )

                        if result.exit_code != 0:
                            print(f"Exit code: {result.exit_code}")
                            print(f"Output: {result.output}")
                            if result.exception:
                                import traceback

                                traceback.print_exception(
                                    type(result.exception),
                                    result.exception,
                                    result.exception.__traceback__,
                                )

                        assert result.exit_code == 0
                        assert "Opened window 'Test-Task'" in result.output
                        mock_move.assert_called_once_with("Test-Task", "Research")


@pytest.mark.unit
def test_cli_group_commands():
    """Test CLI group management commands."""
    from click.testing import CliRunner
    from llm_burst.cli_click import cli

    runner = CliRunner()

    # Test group list
    with patch("llm_burst.cli_click.list_groups_sync") as mock_list:
        # Use TabGroup objects instead of mocks
        from llm_burst.state import TabGroup

        group1 = TabGroup(group_id=1, name="Research", color="blue")
        group2 = TabGroup(group_id=2, name="Coding", color="green")

        mock_list.return_value = {1: group1, 2: group2}

        result = runner.invoke(cli, ["group", "list"])
        if result.exit_code != 0:
            print(result.output)
            print(result.exception)
        assert result.exit_code == 0
        assert "Research" in result.output
        assert "Coding" in result.output
        assert "blue" in result.output

    # Test group create
    with patch("llm_burst.cli_click.create_group_sync") as mock_create:
        mock_group = Mock(group_id=3, name="Writing", color="yellow")
        mock_create.return_value = mock_group

        result = runner.invoke(cli, ["group", "create", "Writing", "--color", "yellow"])
        assert result.exit_code == 0
        # Check for the actual output format
        assert "Writing" in result.output
        assert "ready" in result.output.lower()

    # Test group move
    with patch("llm_burst.cli_click.move_to_group_sync") as mock_move:
        result = runner.invoke(cli, ["group", "move", "Task-1", "Research"])
        assert result.exit_code == 0
        assert "Moved 'Task-1' → 'Research'" in result.output
        mock_move.assert_called_once_with("Task-1", "Research")
