"""
Test InjectOptions and provider injector functionality.

Tests:
- InjectOptions dataclass creation
- Provider configuration for all providers
- Research/incognito flag formatting
- Follow-up mode selection
"""

import pytest
from unittest.mock import AsyncMock

from llm_burst.providers import InjectOptions, get_injector
from llm_burst.constants import LLMProvider


class TestInjectOptions:
    """Test InjectOptions dataclass functionality."""

    def test_default_values(self):
        """Test that InjectOptions has correct defaults."""
        opts = InjectOptions()
        assert opts.follow_up is False
        assert opts.research is False
        assert opts.incognito is False

    def test_custom_values(self):
        """Test custom InjectOptions values."""
        opts = InjectOptions(follow_up=True, research=True, incognito=True)
        assert opts.follow_up is True
        assert opts.research is True
        assert opts.incognito is True


class TestProviderInjectors:
    """Test provider injector configuration."""

    def test_all_providers_configured(self):
        """Test that all providers have injectors configured."""
        for provider in LLMProvider:
            injector = get_injector(provider)
            assert injector is not None
            assert callable(injector)

    def test_unknown_provider_raises(self):
        """Test that unknown provider raises KeyError."""

        class FakeProvider:
            name = "FAKE"

        with pytest.raises(KeyError, match="Unknown provider"):
            get_injector(FakeProvider())

    @pytest.mark.asyncio
    async def test_research_incognito_flags_chatgpt(self):
        """Test that research/incognito flags are passed to ChatGPT."""
        mock_page = AsyncMock()

        # Test with research and incognito enabled
        opts = InjectOptions(research=True, incognito=True)
        injector = get_injector(LLMProvider.CHATGPT)

        await injector(mock_page, "test prompt", opts)

        # Check that evaluate was called twice (once for JS, once for call)
        assert mock_page.evaluate.call_count == 2

        # Check the second call contains correct flags
        second_call = mock_page.evaluate.call_args_list[1][0][0]
        assert "'Yes'" in second_call  # Should have 'Yes' for enabled flags
        assert "automateOpenAIChat" in second_call

    @pytest.mark.asyncio
    async def test_follow_up_mode_selection(self):
        """Test that follow_up flag selects correct JS and template."""
        mock_page = AsyncMock()

        # Test follow-up mode
        opts = InjectOptions(follow_up=True)
        injector = get_injector(LLMProvider.CHATGPT)

        await injector(mock_page, "follow up message", opts)

        # Check that the follow-up function was called
        second_call = mock_page.evaluate.call_args_list[1][0][0]
        assert "chatGPTFollowUpMessage" in second_call

        # Test normal mode
        opts = InjectOptions(follow_up=False)
        await injector(mock_page, "normal message", opts)

        # Check that the submit function was called
        fourth_call = mock_page.evaluate.call_args_list[3][0][0]
        assert "automateOpenAIChat" in fourth_call

    @pytest.mark.asyncio
    async def test_gemini_without_incognito(self):
        """Test that Gemini doesn't receive incognito flag."""
        mock_page = AsyncMock()

        opts = InjectOptions(research=True, incognito=True)
        injector = get_injector(LLMProvider.GEMINI)

        await injector(mock_page, "test", opts)

        # Gemini should only have research, not incognito
        second_call = mock_page.evaluate.call_args_list[1][0][0]
        assert "automateGeminiChat" in second_call
        # Check that it doesn't pass an undefined incognito parameter
        assert second_call.count("'Yes'") == 1  # Only research should be 'Yes'


class TestProviderIntegration:
    """Test provider integration with CLI."""

    @pytest.mark.asyncio
    async def test_send_prompt_with_options(self):
        """Test send_prompt_sync passes options correctly."""
        from llm_burst.cli import _async_send_prompt
        from llm_burst.browser import SessionHandle
        from llm_burst.state import LiveSession

        # Create mock objects
        mock_page = AsyncMock()
        mock_session = LiveSession(
            task_name="test",
            provider=LLMProvider.CHATGPT,
            target_id="123",
            window_id=456,
        )
        mock_handle = SessionHandle(live=mock_session, page=mock_page)

        # Call with research and incognito
        await _async_send_prompt(
            mock_handle, "test prompt", follow_up=False, research=True, incognito=True
        )

        # Verify page.evaluate was called
        assert mock_page.evaluate.called

    def test_cli_flags_present(self):
        """Test that CLI activate command has research/incognito flags."""
        from llm_burst.cli_click import cmd_activate

        # Get the command's params
        params = cmd_activate.params
        param_names = [p.name for p in params]

        assert "research" in param_names
        assert "incognito" in param_names
