"""Shared pytest fixtures for tests."""

import pytest
from unittest.mock import MagicMock


@pytest.fixture
def page():
    """Mock Playwright page for selector tests."""
    mock_page = MagicMock()

    # Default to returning True for evaluate calls
    mock_page.evaluate.return_value = True

    # Mock set_content for HTML injection tests
    mock_page.set_content = MagicMock()

    return mock_page
