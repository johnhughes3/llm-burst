"""
Tests for Stage-2 browser automation.

These tests verify that the Chrome adapter can:
- Connect to or launch Chrome with CDP
- Create new browser windows (not just tabs)
- Track windows persistently across sessions
- Navigate to different LLM provider URLs
"""

import pytest
from unittest.mock import Mock, AsyncMock, PropertyMock, patch
import types

from llm_burst.browser import BrowserAdapter, SessionHandle
from llm_burst.constants import LLMProvider, LLM_URLS, CHROME_REMOTE_PORT
from llm_burst.state import StateManager

# Mark all tests in this module as unit tests to avoid playwright conflicts
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


@pytest.mark.asyncio
async def test_browser_adapter_context_manager():
    """Test BrowserAdapter can be used as async context manager."""
    with (
        patch("llm_burst.browser.async_playwright") as mock_playwright,
        patch(
            "llm_burst.browser.BrowserAdapter._get_websocket_endpoint",
            new_callable=AsyncMock,
            return_value="ws://dummy",
        ),
    ):
        mock_pw_instance = AsyncMock()
        mock_playwright.return_value.start = AsyncMock(return_value=mock_pw_instance)

        mock_browser = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = []
        mock_browser.contexts = [mock_context]
        mock_pw_instance.chromium.connect_over_cdp = AsyncMock(
            return_value=mock_browser
        )

        async with BrowserAdapter() as adapter:
            assert adapter._browser is mock_browser
            assert adapter._context is mock_context

        # Verify cleanup
        mock_browser.disconnect.assert_called_once()
        mock_pw_instance.stop.assert_called_once()


@pytest.mark.asyncio
async def test_browser_adapter_launches_chrome_if_not_running(temp_state_file):
    """Test that BrowserAdapter launches Chrome if CDP connection fails."""
    ws_side_effect = [
        None,
        "ws://dummy",
        "ws://dummy",
    ]  # First call before launch, second after, third for extra call
    with (
        patch("llm_burst.browser.async_playwright") as mock_playwright,
        patch(
            "llm_burst.browser.BrowserAdapter._get_websocket_endpoint",
            new_callable=AsyncMock,
            side_effect=ws_side_effect,
        ),
        patch("llm_burst.browser.scan_chrome_processes") as mock_scan,
    ):
        mock_scan.return_value = types.SimpleNamespace(
            running=False, remote_debug=False, pids=[]
        )
        mock_pw_instance = AsyncMock()
        mock_playwright.return_value.start = AsyncMock(return_value=mock_pw_instance)

        # First attempt fails (no Chrome running), subsequent attempts succeed
        from playwright.async_api import Error as PlaywrightError

        mock_browser = AsyncMock()
        mock_context = AsyncMock()
        mock_context.pages = []
        mock_browser.contexts = [mock_context]

        # Need to handle multiple calls: initial fail, then success after launch
        # _wait_for_cdp will make a test connection too
        mock_pw_instance.chromium.connect_over_cdp = AsyncMock(
            side_effect=[
                PlaywrightError("Connection refused"),  # Initial attempt fails
                mock_browser,  # _wait_for_cdp test connection succeeds
                mock_browser,  # Final connection succeeds
            ]
        )

        with patch("subprocess.Popen") as mock_popen:
            mock_proc = Mock()
            mock_proc.poll.return_value = None
            mock_popen.return_value = mock_proc

            async with BrowserAdapter() as adapter:
                # Verify Chrome was launched
                mock_popen.assert_called_once()
                args = mock_popen.call_args[0][0]
                assert f"--remote-debugging-port={CHROME_REMOTE_PORT}" in args
                assert adapter._browser is mock_browser


@pytest.mark.asyncio
async def test_open_window_creates_new_window(temp_state_file):
    """Test that open_window creates a new browser window and tracks it."""
    # Ensure clean state
    StateManager._instance = None

    # Ensure no existing session for this test
    state = StateManager()
    if state.get("Test-Task"):
        state._sessions = {}
        state._persist()

    with (
        patch("llm_burst.browser.async_playwright") as mock_playwright,
        patch(
            "llm_burst.browser.BrowserAdapter._get_websocket_endpoint",
            new_callable=AsyncMock,
            return_value="ws://dummy",
        ),
    ):
        # --- Playwright bootstrap --------------------------------------- #
        mock_pw_instance = AsyncMock()
        mock_playwright.return_value.start = AsyncMock(return_value=mock_pw_instance)

        # --- Mock Page -------------------------------------------------- #
        # Create a simple namespace object to avoid Mock attribute issues
        mock_page = types.SimpleNamespace()
        mock_page.guid = "test-page-guid"
        mock_page.goto = AsyncMock(return_value=None)
        mock_page._target_id = "test-target-id"

        # --- Browser / context / CDP wiring ---------------------------- #
        mock_context = AsyncMock()
        # Need at least one page for _get_cdp_connection to work
        mock_initial_page = AsyncMock()  # A different page for initial CDP session
        # Use a real list that we control with PropertyMock
        pages_list = [mock_initial_page]
        type(mock_context).pages = PropertyMock(return_value=pages_list)

        # Mock CDP session for slow path in _find_page_for_target
        mock_session = AsyncMock()

        async def session_send(command, params=None):
            if command == "Target.attachToTarget":
                # After attach, add the page to context
                pages_list.append(mock_page)
                return {}
            if command == "Target.createTarget":
                return {"targetId": "test-target-id"}
            if command == "Browser.getWindowForTarget":
                return {"windowId": 12345}
            if command == "Target.getTargetInfo":
                # Return targetInfo for mock_initial_page (different from test-target-id)
                return {"targetInfo": {"targetId": "initial-page-target-id"}}
            return {}

        mock_session.send = AsyncMock(side_effect=session_send)

        # Mock new_cdp_session to return different sessions based on the page
        async def new_cdp_session(page):
            if page is mock_initial_page:
                # This is for _get_cdp_connection, return the main session
                return mock_session
            elif hasattr(page, "_target_id") and page._target_id == "test-target-id":
                # This is our target page for _find_page_for_target
                # Check by _target_id attribute since object identity might not be preserved
                page_session = AsyncMock()
                page_session.send = AsyncMock(
                    return_value={"targetInfo": {"targetId": "test-target-id"}}
                )
                return page_session
            else:
                # Any other page - this shouldn't happen in our test
                # print(f"WARNING: Unexpected page object: {page}")
                page_session = AsyncMock()
                page_session.send = AsyncMock(
                    return_value={"targetInfo": {"targetId": "other-target-id"}}
                )
                return page_session

        mock_context.new_cdp_session = AsyncMock(side_effect=new_cdp_session)

        mock_connection = AsyncMock()

        async def mock_cdp_send(command, params=None):
            # Handle Tab-Groups probe and standard commands
            if command == "TabGroups.get":
                from playwright.async_api import Error as PlaywrightError

                raise PlaywrightError("methodNotFound")
            if command == "Target.createTarget":
                return {"targetId": "test-target-id"}
            if command == "Browser.getWindowForTarget":
                return {"windowId": 12345}
            raise ValueError(f"Unexpected CDP command: {command}")

        mock_connection.send = AsyncMock(side_effect=mock_cdp_send)
        mock_context._connection = mock_connection

        mock_browser = AsyncMock()
        mock_browser.contexts = [mock_context]
        mock_pw_instance.chromium.connect_over_cdp = AsyncMock(
            return_value=mock_browser
        )

        # --- Execute ---------------------------------------------------- #
        # Patch asyncio.sleep to avoid delays in tests
        with patch("asyncio.sleep", new_callable=AsyncMock):
            async with BrowserAdapter() as adapter:
                handle = await adapter.open_window("Test-Task", LLMProvider.CLAUDE)

                # Verify session handle contents
                assert isinstance(handle, SessionHandle)
                assert handle.live.task_name == "Test-Task"
                assert handle.live.provider == LLMProvider.CLAUDE
                assert handle.live.target_id == "test-target-id"
                assert handle.live.window_id == 12345
                assert handle.page is mock_page

                # Verify navigation call
                mock_page.goto.assert_awaited_once_with(
                    LLM_URLS[LLMProvider.CLAUDE],
                    wait_until="domcontentloaded",
                )

                # Verify state persistence
                state = StateManager()
                session = state.get("Test-Task")
                assert session is not None
                assert session.provider == LLMProvider.CLAUDE


@pytest.mark.asyncio
async def test_open_window_reuses_existing_session(temp_state_file):
    """Test that open_window reuses an existing window if session exists."""
    # Pre-populate state
    state = StateManager()
    state.register(
        task_name="Existing-Task",
        provider=LLMProvider.GEMINI,
        target_id="existing-target",
        window_id=99999,
    )

    with (
        patch("llm_burst.browser.async_playwright") as mock_playwright,
        patch(
            "llm_burst.browser.BrowserAdapter._get_websocket_endpoint",
            new_callable=AsyncMock,
            return_value="ws://dummy",
        ),
    ):
        mock_pw_instance = AsyncMock()
        mock_playwright.return_value.start = AsyncMock(return_value=mock_pw_instance)

        mock_page = AsyncMock()
        mock_page._target_id = "existing-target"
        mock_page.goto = AsyncMock(return_value=None)

        # Mock CDP session for finding existing page
        mock_cdp_session = AsyncMock()
        mock_cdp_session.send = AsyncMock(
            return_value={"targetInfo": {"targetId": "existing-target"}}
        )

        mock_context = AsyncMock()
        mock_context.pages = [mock_page]
        mock_context.new_cdp_session = AsyncMock(return_value=mock_cdp_session)

        mock_browser = AsyncMock()
        mock_browser.contexts = [mock_context]
        mock_pw_instance.chromium.connect_over_cdp = AsyncMock(
            return_value=mock_browser
        )

        async with BrowserAdapter() as adapter:
            handle = await adapter.open_window("Existing-Task", LLMProvider.GEMINI)

            # Should reuse existing page, not create new
            assert handle.page is mock_page
            assert handle.live.target_id == "existing-target"
            assert handle.live.window_id == 99999


def test_cli_open_llm_window():
    """Test the synchronous CLI wrapper for opening windows."""
    from llm_burst.cli import open_llm_window

    with patch("llm_burst.cli.asyncio.run") as mock_run:
        mock_handle = Mock(spec=SessionHandle)
        mock_run.return_value = mock_handle

        result = open_llm_window("CLI-Test", LLMProvider.CHATGPT)

        assert result is mock_handle
        mock_run.assert_called_once()


def test_cli_get_running_sessions(temp_state_file):
    """Test retrieving all running sessions from CLI."""
    from llm_burst.cli import get_running_sessions

    # Clear any existing sessions first
    state = StateManager()
    for task_name in list(state.list_all().keys()):
        state.remove(task_name)

    # Setup some test sessions
    state.register("Task-1", LLMProvider.CLAUDE, "target-1", 111)
    state.register("Task-2", LLMProvider.GROK, "target-2", 222)

    sessions = get_running_sessions()

    assert len(sessions) == 2
    assert sessions["Task-1"]["provider"] == "CLAUDE"
    assert sessions["Task-1"]["window_id"] == 111
    assert sessions["Task-2"]["provider"] == "GROK"
    assert sessions["Task-2"]["window_id"] == 222
