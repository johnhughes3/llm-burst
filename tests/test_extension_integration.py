"""
Integration tests for the LLM Burst Helper Chrome extension.
Tests tab grouping, window management, and message passing functionality.
"""

import asyncio
import pytest
from pathlib import Path
from unittest.mock import AsyncMock
from playwright.async_api import async_playwright, Page

# Get the extension path
EXTENSION_PATH = Path(__file__).parent.parent / "chrome_ext"

@pytest.fixture
async def browser_with_extension():
    """Create a browser instance with the extension loaded."""
    async with async_playwright() as p:
        # Launch Chrome with the extension
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="",  # Use temp dir
            headless=False,  # Extensions require headed mode
            args=[
                f"--disable-extensions-except={EXTENSION_PATH}",
                f"--load-extension={EXTENSION_PATH}",
                "--no-first-run",
                "--disable-default-apps",
            ],
            ignore_default_args=["--disable-extensions"],
        )
        yield browser
        await browser.close()


@pytest.mark.asyncio
@pytest.mark.integration
async def test_extension_detection(browser_with_extension):
    """Test that the extension can be detected on a page."""
    page = await browser_with_extension.new_page()
    
    # Navigate to a test page
    await page.goto("https://www.nytimes.com")
    await page.wait_for_load_state("networkidle")
    
    # Wait a bit for extension to inject
    await asyncio.sleep(1)
    
    # Check if extension is available
    result = await page.evaluate("""
        () => new Promise((resolve) => {
            if (window.__llmBurstExtension && window.__llmBurstExtension.ping) {
                window.__llmBurstExtension.ping().then(response => {
                    resolve(response);
                }).catch(err => resolve({ ok: false, error: err.message }));
            } else {
                resolve({ ok: false, error: 'Extension not found' });
            }
        })
    """)
    
    assert result.get("ok") is True, f"Extension detection failed: {result.get('error')}"
    assert "version" in result


@pytest.mark.asyncio
@pytest.mark.integration
async def test_tab_grouping(browser_with_extension):
    """Test creating tab groups with multiple tabs."""
    # Create multiple tabs
    tab1 = await browser_with_extension.new_page()
    tab2 = await browser_with_extension.new_page()
    tab3 = await browser_with_extension.new_page()
    
    # Navigate to test URLs
    await tab1.goto("https://www.nytimes.com")
    await tab2.goto("https://www.cnn.com")
    await tab3.goto("https://www.nytimes.com/section/technology")
    
    # Wait for pages to load
    await tab1.wait_for_load_state("networkidle")
    await tab2.wait_for_load_state("networkidle")
    await tab3.wait_for_load_state("networkidle")
    
    # Wait for extension injection
    await asyncio.sleep(1)
    
    # Group tabs using the extension
    group_name = "Test News Group"
    group_color = "blue"
    session_id = "test-session-123"
    
    # Add each tab to the group
    for tab in [tab1, tab2, tab3]:
        result = await tab.evaluate("""
            (title, color, sessionId) => {
                if (window.__llmBurstExtension && window.__llmBurstExtension.addToGroup) {
                    return window.__llmBurstExtension.addToGroup(title, color, sessionId);
                }
                return { ok: false, error: 'Extension function not available' };
            }
        """, group_name, group_color, session_id)
        
        assert result.get("ok") is True, f"Failed to group tab: {result.get('error')}"
        assert "groupId" in result


@pytest.mark.asyncio
@pytest.mark.integration
async def test_open_tabs_grouped(browser_with_extension):
    """Test opening multiple tabs and grouping them together."""
    page = await browser_with_extension.new_page()
    await page.goto("https://www.nytimes.com")
    await page.wait_for_load_state("networkidle")
    await asyncio.sleep(1)
    
    # Open multiple tabs using the extension
    urls = [
        "https://www.cnn.com",
        "https://www.nytimes.com/section/technology",
        "https://www.nytimes.com/section/business"
    ]
    
    result = await page.evaluate("""
        (urls) => {
            if (window.__llmBurstExtension && window.__llmBurstExtension.openTabs) {
                return window.__llmBurstExtension.openTabs(urls, {
                    grouped: true,
                    groupTitle: 'Test Group',
                    groupColor: 'purple'
                });
            }
            return { ok: false, error: 'Extension function not available' };
        }
    """, urls)
    
    assert result.get("ok") is True, f"Failed to open tabs: {result.get('error')}"
    assert "tabs" in result
    assert len(result["tabs"]) == len(urls)
    assert "groupId" in result


@pytest.mark.asyncio
@pytest.mark.integration
async def test_extension_with_browser_adapter():
    """Test the BrowserAdapter integration with the extension."""
    from llm_burst.browser import BrowserAdapter
    
    # Use the BrowserAdapter with extension support
    async with BrowserAdapter() as adapter:
        # Create a test page
        from llm_burst.constants import LLMProvider
        handle = await adapter.open_window("test_task", LLMProvider.CLAUDE)
        
        if handle and handle.page:
            # Navigate to a test URL
            await handle.page.goto("https://www.nytimes.com")
            await handle.page.wait_for_load_state("networkidle")
            
            # Check extension availability
            is_available = await adapter.check_extension_available(handle.page)
            
            # If extension is loaded (in real browser with extension)
            if is_available:
                # Test grouping via extension
                success = await adapter.group_tab_via_extension(
                    handle.page,
                    "Test Group",
                    "blue",
                    "test-session"
                )
                assert success, "Failed to group tab via extension"
            else:
                # Extension not loaded in test environment (expected in CI)
                pytest.skip("Extension not available in test environment")


@pytest.mark.asyncio
@pytest.mark.unit
async def test_extension_detection_mock():
    """Unit test for extension detection with mocked page."""
    from llm_burst.browser import BrowserAdapter
    
    adapter = BrowserAdapter()
    mock_page = AsyncMock(spec=Page)
    
    # Mock successful extension detection
    mock_page.evaluate.return_value = True
    result = await adapter.check_extension_available(mock_page)
    assert result is True
    
    # Mock failed extension detection
    mock_page.evaluate.return_value = False
    result = await adapter.check_extension_available(mock_page)
    assert result is False
    
    # Mock exception during detection
    mock_page.evaluate.side_effect = Exception("Evaluation failed")
    result = await adapter.check_extension_available(mock_page)
    assert result is False


@pytest.mark.asyncio
@pytest.mark.unit
async def test_group_tab_via_extension_mock():
    """Unit test for tab grouping via extension with mocked page."""
    from llm_burst.browser import BrowserAdapter
    
    adapter = BrowserAdapter()
    mock_page = AsyncMock(spec=Page)
    
    # Mock extension not available
    async def evaluate_not_available(script, *args):
        if "ping" in script:
            return False
        return {"ok": False, "error": "Extension not available"}
    
    mock_page.evaluate.side_effect = evaluate_not_available
    result = await adapter.group_tab_via_extension(mock_page, "Test", "blue")
    assert result is False
    
    # Mock successful grouping
    call_count = 0
    async def evaluate_success(script, *args):
        nonlocal call_count
        call_count += 1
        if call_count == 1:  # First call is extension check
            return True
        return {"ok": True, "groupId": 123}
    
    mock_page.evaluate.side_effect = evaluate_success
    result = await adapter.group_tab_via_extension(mock_page, "Test", "blue", "session-1")
    assert result is True
    
    # Mock grouping failure
    call_count = 0
    async def evaluate_failure(script, *args):
        nonlocal call_count
        call_count += 1
        if call_count == 1:  # First call is extension check
            return True
        return {"ok": False, "error": "Grouping failed"}
    
    mock_page.evaluate.side_effect = evaluate_failure
    result = await adapter.group_tab_via_extension(mock_page, "Test", "blue")
    assert result is False


@pytest.mark.asyncio
@pytest.mark.integration
async def test_session_tracking(browser_with_extension):
    """Test session and window tracking functionality."""
    page = await browser_with_extension.new_page()
    await page.goto("https://www.nytimes.com")
    await page.wait_for_load_state("networkidle")
    await asyncio.sleep(1)
    
    session_id = "test-session-456"
    
    # Add current tab to a group with session tracking
    result = await page.evaluate("""
        (sessionId) => {
            if (window.__llmBurstExtension && window.__llmBurstExtension.addToGroup) {
                return window.__llmBurstExtension.addToGroup('Session Test', 'green', sessionId);
            }
            return { ok: false, error: 'Extension function not available' };
        }
    """, session_id)
    
    assert result.get("ok") is True
    
    # Get session info
    info_result = await page.evaluate("""
        (sessionId) => {
            if (window.__llmBurstExtension && window.__llmBurstExtension.getSessionInfo) {
                return window.__llmBurstExtension.getSessionInfo(sessionId);
            }
            return { ok: false, error: 'Extension function not available' };
        }
    """, session_id)
    
    assert info_result.get("ok") is True
    assert info_result.get("sessionId") == session_id
    assert "windows" in info_result


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v", "-m", "unit"])