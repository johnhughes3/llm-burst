#!/usr/bin/env python3
"""
Direct test of Chrome extension using postMessage without helper.
"""

import asyncio
from playwright.async_api import async_playwright


async def test_direct_messaging():
    """Test extension using direct postMessage."""
    print("Direct Extension Test - PostMessage Only")
    print("=" * 60)
    
    async with async_playwright() as p:
        # Connect to Chrome
        print("Connecting to Chrome on port 9222...")
        try:
            browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        except Exception as e:
            print(f"❌ Failed to connect: {e}")
            return False
        
        context = browser.contexts[0] if browser.contexts else None
        if not context:
            print("❌ No browser context found")
            return False
        
        # Create test tabs
        print("\n1. Creating test tabs...")
        tab1 = await context.new_page()
        await tab1.goto("https://www.nytimes.com")
        print("   ✓ NY Times loaded")
        
        tab2 = await context.new_page()  
        await tab2.goto("https://www.cnn.com")
        print("   ✓ CNN loaded")
        
        # Wait for pages to settle
        await asyncio.sleep(3)
        
        # Test direct postMessage
        print("\n2. Testing direct postMessage to extension...")
        
        # Send message and wait for response
        result = await tab1.evaluate("""
            () => new Promise((resolve) => {
                // Set up response listener
                const timeout = setTimeout(() => {
                    resolve({ ok: false, error: 'Timeout - no response from extension' });
                }, 3000);
                
                const handler = (event) => {
                    if (event.data && event.data.type === 'llmburst-group-response') {
                        clearTimeout(timeout);
                        window.removeEventListener('message', handler);
                        resolve(event.data);
                    }
                };
                
                window.addEventListener('message', handler);
                
                // Send the message
                window.postMessage({
                    type: 'llmburst-group',
                    title: 'Test Group',
                    color: 'blue',
                    sessionId: 'test-123'
                }, '*');
            })
        """)
        
        print(f"   Result: {result}")
        
        if result.get("ok"):
            print(f"   ✅ Tab 1 grouped! Group ID: {result.get('groupId')}")
            
            # Group second tab
            print("\n3. Grouping second tab...")
            result2 = await tab2.evaluate("""
                () => new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        resolve({ ok: false, error: 'Timeout' });
                    }, 3000);
                    
                    const handler = (event) => {
                        if (event.data && event.data.type === 'llmburst-group-response') {
                            clearTimeout(timeout);
                            window.removeEventListener('message', handler);
                            resolve(event.data);
                        }
                    };
                    
                    window.addEventListener('message', handler);
                    
                    window.postMessage({
                        type: 'llmburst-group',
                        title: 'Test Group',
                        color: 'blue',
                        sessionId: 'test-123'
                    }, '*');
                })
            """)
            
            if result2.get("ok"):
                print(f"   ✅ Tab 2 grouped! Group ID: {result2.get('groupId')}")
                print("\n" + "=" * 60)
                print("SUCCESS! Both tabs should now be in a blue 'Test Group'")
                print("=" * 60)
            else:
                print(f"   ❌ Failed to group tab 2: {result2.get('error')}")
        else:
            print(f"   ❌ Extension not responding: {result.get('error')}")
            print("\nTroubleshooting:")
            print("1. Make sure extension is loaded: chrome://extensions")
            print("2. After loading extension, refresh this test")
            print("3. Check extension permissions include these domains")
        
        # Keep open for observation
        print("\nKeeping tabs open for 10 seconds...")
        await asyncio.sleep(10)
        
        return result.get("ok", False)


if __name__ == "__main__":
    success = asyncio.run(test_direct_messaging())
    exit(0 if success else 1)