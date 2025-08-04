from llm_burst.sites import grok


def test_selectors_up_to_date(page):
    page.set_content(
        "<textarea aria-label='Ask Grok anything'></textarea>"
        "<button type='submit'></button>"
    )
    assert grok.selectors_up_to_date(page)
