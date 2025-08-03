"""
Tests for Stage 4 auto-naming functionality.
"""

import asyncio
from unittest.mock import Mock, MagicMock, patch, AsyncMock

import pytest

from llm_burst.constants import LLMProvider
from llm_burst.state import LiveSession


@pytest.mark.unit
def test_placeholder_generation():
    """Test that placeholder names are generated correctly."""
    from llm_burst.cli import _generate_placeholder
    
    placeholder = _generate_placeholder(LLMProvider.GEMINI)
    assert placeholder.startswith("GEMINI-")
    assert len(placeholder) == 11  # GEMINI-xxxx
    
    placeholder = _generate_placeholder(LLMProvider.CLAUDE)
    assert placeholder.startswith("CLAUDE-")


@pytest.mark.unit
def test_is_placeholder_name():
    """Test placeholder name detection."""
    from llm_burst.auto_namer import _is_placeholder_name
    
    # Valid placeholders
    assert _is_placeholder_name("GEMINI-1234")
    assert _is_placeholder_name("CLAUDE-abcd")
    assert _is_placeholder_name("CHATGPT-12ab")
    assert _is_placeholder_name("GROK-0000")
    
    # Not placeholders
    assert not _is_placeholder_name("My Research Task")
    assert not _is_placeholder_name("GEMINI-Research")
    assert not _is_placeholder_name("Random-1234")
    assert not _is_placeholder_name("GEMINI")


@pytest.mark.unit
def test_state_rename():
    """Test StateManager rename method."""
    from llm_burst.state import StateManager
    
    # Create fresh state manager
    with patch('llm_burst.state.StateManager._instance', None):
        state = StateManager()
        
        # Mock initial sessions
        session = LiveSession(
            task_name="OLD-NAME",
            provider=LLMProvider.GEMINI,
            target_id="target-1",
            window_id=100,
        )
        state._sessions = {"OLD-NAME": session}
        
        # Test successful rename
        with patch.object(state, '_persist'):
            renamed = state.rename("OLD-NAME", "NEW-NAME")
            assert renamed is not None
            assert renamed.task_name == "NEW-NAME"
            assert "OLD-NAME" not in state._sessions
            assert "NEW-NAME" in state._sessions
        
        # Test rename non-existent
        result = state.rename("MISSING", "SOMETHING")
        assert result is None
        
        # Test rename to existing name
        state._sessions["EXISTING"] = Mock()
        result = state.rename("NEW-NAME", "EXISTING")
        assert result is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_extract_conversation():
    """Test conversation extraction from page."""
    from llm_burst.auto_namer import extract_conversation
    
    # Mock page
    page = AsyncMock()
    
    # Mock user message elements
    user_elem = AsyncMock()
    user_elem.inner_text.return_value = "Explain quantum computing"
    
    # Mock assistant message elements
    assistant_elem = AsyncMock()
    assistant_elem.inner_text.return_value = "Quantum computing uses quantum bits..."
    
    page.query_selector_all.side_effect = [
        [user_elem],  # user elements
        [assistant_elem],  # assistant elements
    ]
    
    # Test extraction
    result = await extract_conversation(page, LLMProvider.GEMINI)
    assert result is not None
    assert "User: Explain quantum computing" in result
    assert "Assistant: Quantum computing uses quantum bits" in result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_generate_task_name():
    """Test task name generation with mocked Gemini."""
    from llm_burst.auto_namer import generate_task_name
    
    # Mock model
    model = Mock()
    response = Mock()
    response.text = '{"task_name": "Quantum Computing Research"}'
    model.generate_content.return_value = response
    
    # Test generation
    conversation = "User: Explain quantum computing\nAssistant: Quantum computing uses..."
    
    # Wrap synchronous call in async
    with patch('asyncio.to_thread', new_callable=AsyncMock) as mock_to_thread:
        mock_to_thread.return_value = response
        result = await generate_task_name(conversation, model)
    
    assert result == "Quantum Computing Research"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_auto_name_session_full_flow():
    """Test complete auto-naming flow."""
    from llm_burst.auto_namer import auto_name_session
    
    # Create session with placeholder name
    session = LiveSession(
        task_name="GEMINI-1234",
        provider=LLMProvider.GEMINI,
        target_id="target-1",
        window_id=100,
    )
    
    # Mock page
    page = AsyncMock()
    
    # Mock dependencies
    with patch('llm_burst.auto_namer._setup_gemini') as mock_setup:
        with patch('llm_burst.auto_namer.extract_conversation') as mock_extract:
            with patch('llm_burst.auto_namer.generate_task_name') as mock_generate:
                with patch('llm_burst.auto_namer.StateManager') as MockState:
                    with patch('llm_burst.auto_namer.set_window_title') as mock_set_title:
                        # Setup mocks
                        mock_setup.return_value = Mock()  # Valid model
                        mock_extract.return_value = "User: Test\nAssistant: Response"
                        mock_generate.return_value = "Test Task Name"
                        
                        state_instance = Mock()
                        renamed_session = Mock(task_name="Test Task Name")
                        state_instance.rename.return_value = renamed_session
                        MockState.return_value = state_instance
                        
                        # Run auto-naming
                        result = await auto_name_session(session, page)
                        
                        # Verify
                        assert result == "Test Task Name"
                        state_instance.rename.assert_called_once_with("GEMINI-1234", "Test Task Name")
                        mock_set_title.assert_called_once()


@pytest.mark.unit
def test_cli_open_with_auto_naming():
    """Test CLI open command with auto-naming."""
    from click.testing import CliRunner
    from llm_burst.cli_click import cli
    
    runner = CliRunner()
    
    with patch('llm_burst.cli_click.open_llm_window') as mock_open:
        with patch('llm_burst.cli_click.auto_name_sync') as mock_auto_name:
            with patch('llm_burst.cli_click.send_prompt_sync') as mock_send:
                with patch('llm_burst.state.StateManager') as MockState:
                    with patch('llm_burst.cli_click.prompt_user') as mock_prompt:
                        # Setup mocks
                        handle = Mock()
                        handle.live.task_name = "GEMINI-abcd"
                        mock_open.return_value = handle
                        mock_auto_name.return_value = "Research Task"
                        
                        # Mock StateManager to avoid reuse check
                        state_instance = Mock()
                        state_instance.list_all.return_value = {}
                        MockState.return_value = state_instance
                        
                        # Mock prompt_user (in case it's called for missing values)
                        mock_prompt.return_value = {}
                        
                        # Run command without task name (task name will be None)
                        result = runner.invoke(cli, ["open", "-p", "gemini", "-m", "Test prompt"])
                        
                        # Verify
                        assert result.exit_code == 0
                        assert "Opened window 'GEMINI-abcd'" in result.output
                        assert "Session renamed to 'Research Task'" in result.output
                        mock_open.assert_called_once()
                        # Check that None was passed for task_name
                        assert mock_open.call_args[0][0] is None
                        mock_auto_name.assert_called_once_with(handle)
                        mock_send.assert_called_once_with(handle, "Test prompt")