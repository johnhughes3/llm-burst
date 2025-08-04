from llm_burst.sites import claude


def test_selectors_up_to_date(page):
    page.set_content(
        "<div class='ProseMirror'></div><button aria-label='Send message'></button>"
    )
    assert claude.selectors_up_to_date(page)
