#!/usr/bin/env python3
"""
Simple test to verify Chrome extension tab grouping works.
Opens two tabs in the SAME window and groups them.
"""

import asyncio
from playwright.async_api import async_playwright


async def test_extension():
    """Test the extension with two news sites."""
    print("Chrome Extension Tab Grouping Test")
    print("=" * 60)
    print("Prerequisites:")
    print("1. Chrome must be running with remote debugging on port 9222")
    print("2. Extension must be loaded (chrome://extensions -> Load unpacked -> chrome_ext)")
    print("=" * 60)
    
    async with async_playwright() as p:
        # Connect to existing Chrome with debugging port
        print("\nConnecting to Chrome...")
        try:
            browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception as e:
            print(f"❌ Failed to connect to Chrome. Make sure it's running with --remote-debugging-port=9222")
            print(f"   Error: {e}")
            return False
        
        # Get the default context (existing browser session)
        contexts = browser.contexts
        if not contexts:
            print("❌ No browser contexts found")
            return False
        
        context = contexts[0]
        
        # Create first tab
        print("\n1. Creating first tab (NY Times)...")
        tab1 = await context.new_page()
        await tab1.goto("https://www.nytimes.com")
        await tab1.wait_for_load_state("domcontentloaded")
        print("   ✓ NY Times loaded")
        
        # Create second tab in SAME window
        print("\n2. Creating second tab (CNN) in same window...")
        tab2 = await context.new_page()
        await tab2.goto("https://www.cnn.com")
        await tab2.wait_for_load_state("domcontentloaded")
        print("   ✓ CNN loaded")
        
        # Wait a moment for extension to inject
        print("\n3. Waiting for extension to inject...")
        await asyncio.sleep(3)
        
        # Try reloading to ensure extension content script loads
        print("   Reloading pages to ensure extension loads...")
        await tab1.reload()
        await tab2.reload()
        await tab1.wait_for_load_state("domcontentloaded")
        await tab2.wait_for_load_state("domcontentloaded")
        await asyncio.sleep(2)
        
        # Check if extension is available
        print("\n4. Checking extension availability...")
        extension_check = await tab1.evaluate("""
            () => {
                // Check multiple ways
                if (window.__llmBurstExtension) return 'helper_found';
                // Try sending a ping directly
                window.postMessage({ type: 'llmburst-ping' }, '*');
                return 'ping_sent';
            }
        """)
        
        print(f"   Extension check result: {extension_check}")
        
        if extension_check == 'ping_sent':
            print("   Extension might be present but helper not injected yet")
            print("   Trying direct message approach...")
        elif extension_check == 'helper_found':
            print("   ✓ Extension helper detected")
        else:
            print("❌ Extension not detected. Please make sure:")
            print("   - Extension is loaded at chrome://extensions")
            print("   - Extension is enabled")
            print("   - You've refreshed the pages after loading the extension")
            return False
        
        # Group the tabs
        print("\n5. Grouping tabs...")
        group_name = "News Sites"
        group_color = "blue"
        
        # Group first tab
        print(f"   Grouping NY Times...")
        result1 = await tab1.evaluate("""
            (args) => {
                const { title, color } = args;
                if (window.__llmBurstExtension && window.__llmBurstExtension.addToGroup) {
                    return window.__llmBurstExtension.addToGroup(title, color, 'test-session');
                } else {
                    return { ok: false, error: 'Extension function not found' };
                }
            }
        """, {"title": group_name, "color": group_color})
        
        if not result1.get("ok"):
            print(f"   ❌ Failed to group NY Times: {result1.get('error')}")
            return False
        
        print(f"   ✓ NY Times added to group (ID: {result1.get('groupId')})")
        
        # Group second tab
        print(f"   Grouping CNN...")
        result2 = await tab2.evaluate("""
            (args) => {
                const { title, color } = args;
                if (window.__llmBurstExtension && window.__llmBurstExtension.addToGroup) {
                    return window.__llmBurstExtension.addToGroup(title, color, 'test-session');
                } else {
                    return { ok: false, error: 'Extension function not found' };
                }
            }
        """, {"title": group_name, "color": group_color})
        
        if not result2.get("ok"):
            print(f"   ❌ Failed to group CNN: {result2.get('error')}")
            return False
        
        print(f"   ✓ CNN added to group (ID: {result2.get('groupId')})")
        
        print("\n" + "=" * 60)
        print("✅ SUCCESS! Both tabs are now in a blue tab group called 'News Sites'")
        print("You should see the grouped tabs in your Chrome window.")
        print("=" * 60)
        
        # Keep tabs open for observation
        print("\nKeeping tabs open for 10 seconds...")
        await asyncio.sleep(10)
        
        return True


async def main():
    """Run the test."""
    try:
        success = await test_extension()
        return 0 if success else 1
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)