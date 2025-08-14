#!/usr/bin/env python3
"""
Manual test script to verify the Chrome extension works correctly.
Opens nytimes.com and cnn.com and groups them together using the same
logic as production code.
"""

import asyncio
import sys
from pathlib import Path

# Add the project root to path
sys.path.insert(0, str(Path(__file__).parent))

from llm_burst.browser import BrowserAdapter
from llm_burst.constants import LLMProvider


async def test_extension_grouping():
    """Test opening tabs and grouping them with the extension."""
    print("Starting Chrome extension test...")
    print("Make sure the extension is loaded in Chrome before running this test.")
    print("-" * 60)
    
    async with BrowserAdapter() as adapter:
        print("\n1. Opening first tab (NY Times)...")
        
        # Open first tab using the same logic as production
        # We'll use CLAUDE provider just for the window opening mechanism
        handle1 = await adapter.open_window("test_news_task", LLMProvider.CLAUDE)
        
        if not handle1 or not handle1.page:
            print("❌ Failed to open first window")
            return False
        
        # Navigate to NY Times instead of Claude
        print("   Navigating to nytimes.com...")
        await handle1.page.goto("https://www.nytimes.com", timeout=30000)
        # Don't wait for full network idle, just DOM content
        await handle1.page.wait_for_load_state("domcontentloaded")
        
        print("\n2. Opening second tab (CNN) in same window...")
        
        # Open second tab in the same window
        opener_target = handle1.live.target_id
        handle2 = await adapter.open_tab_in_window(
            "test_cnn_task", 
            LLMProvider.GEMINI,  # Different provider for variety
            opener_target
        )
        
        if not handle2 or not handle2.page:
            print("❌ Failed to open second tab")
            return False
            
        # Navigate to CNN
        print("   Navigating to cnn.com...")
        await handle2.page.goto("https://www.cnn.com", timeout=30000)
        # Don't wait for full network idle, just DOM content
        await handle2.page.wait_for_load_state("domcontentloaded")
        
        print("\n3. Checking if extension is available...")
        
        # Check extension on first tab
        extension_available = await adapter.check_extension_available(handle1.page)
        
        if not extension_available:
            print("❌ Extension not detected. Please ensure:")
            print("   1. Chrome extension is loaded at chrome://extensions")
            print("   2. The extension is enabled")
            print("   3. You've loaded the 'chrome_ext' folder as unpacked extension")
            return False
        
        print("✅ Extension detected!")
        
        print("\n4. Grouping tabs using extension...")
        
        # Group both tabs using the same logic as production
        group_name = "News Sites Test"
        group_color = "blue"
        session_id = "test-session-news"
        
        # Group first tab
        print(f"   Adding NY Times to group '{group_name}'...")
        success1 = await adapter.group_tab_via_extension(
            handle1.page, 
            group_name, 
            group_color, 
            session_id
        )
        
        if not success1:
            print("❌ Failed to group NY Times tab")
            return False
        
        # Group second tab
        print(f"   Adding CNN to group '{group_name}'...")
        success2 = await adapter.group_tab_via_extension(
            handle2.page,
            group_name,
            group_color,
            session_id
        )
        
        if not success2:
            print("❌ Failed to group CNN tab")
            return False
        
        print(f"\n✅ SUCCESS! Both tabs grouped into '{group_name}'")
        print("\nYou should now see:")
        print(f"  - A blue tab group labeled '{group_name}'")
        print("  - NY Times and CNN tabs inside the group")
        print("\nTest completed successfully!")
        
        # Keep browser open for 10 seconds to observe
        print("\nKeeping browser open for 10 seconds...")
        await asyncio.sleep(10)
        
        return True


async def main():
    """Run the test."""
    try:
        success = await test_extension_grouping()
        if success:
            print("\n✅ All tests passed!")
            return 0
        else:
            print("\n❌ Test failed")
            return 1
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        return 0
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)