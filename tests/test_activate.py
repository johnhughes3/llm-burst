import pytest
from llm_burst.sites import gemini


def test_selectors_up_to_date(page):
    """Injects minimal HTML needed for Gemini selectors to pass."""
    page.set_content(
        "<div class='ql-editor'></div>"
        "<button class='send-button'></button>"
    )
    assert gemini.selectors_up_to_date(page)