import pytest
from llm_burst.sites import chatgpt


def test_selectors_up_to_date(page):
    page.set_content(
        "<div class='ProseMirror'></div>"
        "<button type='submit'></button>"
    )
    assert chatgpt.selectors_up_to_date(page)