"""Tests for improved dialog keyboard shortcuts and functionality."""

import pytest
import json
from unittest.mock import patch, MagicMock
from llm_burst.cli import _run_jxa_prompt


class TestDialogKeyboardShortcuts:
    """Test suite for dialog keyboard shortcuts."""

    def test_jxa_prompt_has_keyboard_shortcuts(self):
        """Test that JXA prompt includes keyboard shortcuts in UI."""
        # This test verifies the JXA script contains the keyboard shortcut definitions
        from llm_burst.cli import _run_jxa_prompt

        # Get the JXA script from the function
        import inspect

        source = inspect.getsource(_run_jxa_prompt)

        # Check for keyboard shortcut indicators in the UI
        assert "⌘R" in source or "\\u2318R" in source, (
            "Research mode should show Cmd+R shortcut"
        )
        assert "⌘I" in source or "\\u2318I" in source, (
            "Incognito mode should show Cmd+I shortcut"
        )

        # Check for keyboard shortcut setup code
        assert "setKeyEquivalent" in source, "Should set up keyboard shortcuts"
        assert "NSEventModifierFlagCommand" in source, "Should use Command modifier"

    def test_jxa_prompt_escape_key_cancel(self):
        """Test that Escape key is set up for Cancel button."""
        import inspect

        source = inspect.getsource(_run_jxa_prompt)

        # Check for Escape key setup on cancel button
        assert "\\x1b" in source or "Escape" in source, (
            "Cancel button should have Escape key shortcut"
        )
        assert "cancelButton" in source, "Should reference cancel button"

    def test_jxa_prompt_text_editing_features(self):
        """Test that text editing features are enabled."""
        import inspect

        source = inspect.getsource(_run_jxa_prompt)

        # Check for text editing setup
        assert "setAllowsUndo" in source, "Should enable undo/redo"
        assert "setAutomaticTextReplacementEnabled" in source, (
            "Should configure text replacement"
        )
        assert "setAutorecalculatesKeyViewLoop" in source, (
            "Should enable tab navigation"
        )

    def test_jxa_prompt_window_activation(self):
        """Test that window activation features are present."""
        import inspect

        source = inspect.getsource(_run_jxa_prompt)

        # Check for window activation features
        assert "activateIgnoringOtherApps" in source, (
            "Should activate app ignoring others"
        )
        assert "makeKeyAndOrderFront" in source, "Should bring window to front"
        assert "NSModalPanelWindowLevel" in source or "setLevel" in source, (
            "Should set window level"
        )
        assert "center()" in source or "window.center" in source, "Should center window"


    @patch("subprocess.run")
    def test_dialog_cancellation_handling(self, mock_run):
        """Test that dialog cancellation is properly handled."""
        # Simulate user pressing Cancel/Escape
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps({"__cancelled__": True})
        mock_result.stderr = None
        mock_run.return_value = mock_result

        result = _run_jxa_prompt("test clipboard", debug=False)

        assert result is not None
        assert result.get("__cancelled__") is True

    @patch("subprocess.run")
    def test_dialog_with_active_sessions(self, mock_run):
        """Test dialog with active session selection."""
        # Simulate dialog with session selector
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = json.dumps(
            {
                "Prompt Text": "test prompt",
                "Research mode": True,
                "Incognito mode": False,
                "Selected Session": "Session-1",
            }
        )
        mock_result.stderr = None
        mock_run.return_value = mock_result

        active_sessions = ["Session-1", "Session-2", "Session-3"]
        result = _run_jxa_prompt(
            "test clipboard", debug=False, active_sessions=active_sessions
        )

        assert result is not None
        assert result.get("Prompt Text") == "test prompt"
        assert result.get("Research mode") is True
        assert result.get("Selected Session") == "Session-1"

        # Verify active sessions were passed to environment
        mock_run.assert_called_once()
        call_env = mock_run.call_args[1]["env"]
        assert "LLM_BURST_ACTIVE_SESSIONS" in call_env
        assert json.loads(call_env["LLM_BURST_ACTIVE_SESSIONS"]) == active_sessions


class TestResearchModeActivation:
    """Test suite for ChatGPT research mode improvements."""

    def test_chatgpt_research_mode_plus_button_approach(self):
        """Test that ChatGPT uses plus button as primary method."""
        from llm_burst.sites.chatgpt import SUBMIT_JS

        # Check that the plus button approach is primary
        assert "plusButton = document.querySelector" in SUBMIT_JS
        assert '[data-testid="composer-plus-btn"]' in SUBMIT_JS

        # Check for improved selectors
        assert "button.getBoundingClientRect" in SUBMIT_JS or "buttonRect" in SUBMIT_JS
        assert "inputRect" in SUBMIT_JS or "input area" in SUBMIT_JS.lower()

        # Check for fallback to slash command
        assert "slashCommandFallback" in SUBMIT_JS

    def test_chatgpt_research_mode_verification(self):
        """Test that research mode includes verification checks."""
        from llm_burst.sites.chatgpt import SUBMIT_JS

        # Check for verification logic
        assert "verifyActivation" in SUBMIT_JS or "aria-checked" in SUBMIT_JS
        assert "Deep research mode successfully activated" in SUBMIT_JS
        # Check for various verification messages
        assert any(
            msg in SUBMIT_JS
            for msg in [
                "Deep research mode verified",
                "verified as active",
                "Deep research mode enabled",
                "successfully activated",
            ]
        )

    def test_chatgpt_research_prompts_navigation(self):
        """Test that Research Prompts GPT navigation is handled."""
        from llm_burst.providers import _build_chatgpt_injector
        import inspect

        # Get the source of the ChatGPT injector
        source = inspect.getsource(_build_chatgpt_injector)

        # Check for Research Prompts GPT URL
        assert "research-prompts" in source.lower()
        assert "chatgpt.com/g/g-p-" in source

    @pytest.mark.asyncio
    async def test_research_mode_verification_in_provider(self):
        """Test that provider includes research mode verification."""
        import inspect
        from llm_burst.providers import _build_chatgpt_injector

        source = inspect.getsource(_build_chatgpt_injector)

        # Check for verification script
        assert "verification" in source.lower() or "verify" in source.lower()
        assert (
            "Research mode active" in source
            or "research mode verified" in source.lower()
        )

    def test_chatgpt_menu_item_detection_improved(self):
        """Test improved menu item detection for Deep research."""
        from llm_burst.sites.chatgpt import SUBMIT_JS

        # Check for exact matching
        assert "text === 'Deep research'" in SUBMIT_JS
        assert "text.toLowerCase() === 'deep research'" in SUBMIT_JS

        # Check for broader menu item selectors
        assert '[role="menuitemradio"]' in SUBMIT_JS
        assert '[role="menuitem"]' in SUBMIT_JS
        assert '[role="option"]' in SUBMIT_JS

    def test_chatgpt_fallback_slash_command(self):
        """Test that slash command fallback is comprehensive."""
        from llm_burst.sites.chatgpt import SUBMIT_JS

        # Check for proper event dispatching in slash command
        assert "beforeinput" in SUBMIT_JS
        assert "InputEvent" in SUBMIT_JS
        assert "KeyboardEvent" in SUBMIT_JS
        assert "keydown" in SUBMIT_JS

        # Check for command menu detection
        assert '[role="listbox"]' in SUBMIT_JS
        assert "command-menu" in SUBMIT_JS.lower()
