#!/usr/bin/env python3
"""Simple test to verify provider injection scripts load correctly."""

import asyncio
from playwright.async_api import async_playwright
from llm_burst.sites import gemini, grok


async def test_providers():
    """Test provider JavaScript injection."""
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://localhost:9222")
        
        # Test Gemini
        print("\n=== Testing Gemini ===")
        page = await browser.new_page()
        await page.goto("https://gemini.google.com")
        await page.wait_for_timeout(3000)  # Let page load
        
        # Inject and test Gemini script
        await page.evaluate(f"(function() {{ {gemini.SUBMIT_JS} }})()")
        
        # Check if function exists
        exists = await page.evaluate("typeof window.automateGeminiChat === 'function'")
        print(f"automateGeminiChat exists: {exists}")
        
        # Check for editor
        editor_exists = await page.evaluate("""
            () => {
                const editor = document.querySelector('.ql-editor');
                return editor !== null;
            }
        """)
        print(f"Editor found: {editor_exists}")
        
        # Try calling the function with debug
        page.on("console", lambda msg: print(f"[Gemini Console] {msg.text}"))
        
        try:
            await page.evaluate("""
                async () => {
                    console.log('Attempting to call automateGeminiChat...');
                    await window.automateGeminiChat('Test prompt from injection test', 'No');
                }
            """)
        except Exception as e:
            print(f"Error calling automateGeminiChat: {e}")
        
        await page.wait_for_timeout(2000)
        
        # Check editor content
        content = await page.evaluate("""
            () => {
                const editor = document.querySelector('.ql-editor');
                return editor ? editor.textContent : 'No editor';
            }
        """)
        print(f"Editor content after injection: {content}")
        
        await page.close()
        
        # Test Grok
        print("\n=== Testing Grok ===")
        page = await browser.new_page()
        await page.goto("https://x.com/i/grok")
        await page.wait_for_timeout(5000)  # Grok takes longer to load
        
        # Inject helpers first
        await page.evaluate("""
            window.llmBurstWait = function(ms) {
                return new Promise(resolve => setTimeout(resolve, ms));
            };
            window.llmBurstWaitUntil = function(condition, timeout = 3000, interval = 100) {
                return new Promise((resolve, reject) => {
                    const startTime = Date.now();
                    const checkCondition = () => {
                        try {
                            const result = condition();
                            if (result) {
                                resolve(result);
                                return;
                            }
                        } catch (e) {}
                        if (Date.now() - startTime > timeout) {
                            reject(new Error("Timeout waiting for condition"));
                            return;
                        }
                        setTimeout(checkCondition, interval);
                    };
                    checkCondition();
                });
            };
        """)
        
        # Inject Grok script
        await page.evaluate(f"(function() {{ {grok.SUBMIT_JS} }})()")
        
        # Check if function exists
        exists = await page.evaluate("typeof window.automateGrokChat === 'function'")
        print(f"automateGrokChat exists: {exists}")
        
        # Check for input
        input_check = await page.evaluate("""
            () => {
                const textarea = document.querySelector('textarea[aria-label="Ask Grok anything"]');
                const contentEditable = document.querySelector('[contenteditable="true"]');
                if (textarea) return 'Found textarea';
                if (contentEditable) return 'Found contenteditable';
                return 'No input found';
            }
        """)
        print(f"Input element: {input_check}")
        
        page.on("console", lambda msg: print(f"[Grok Console] {msg.text}"))
        
        # Try calling the function
        try:
            await page.evaluate("""
                async () => {
                    console.log('Attempting to call automateGrokChat...');
                    const result = await window.automateGrokChat('Test prompt from injection test', 'No', 'No');
                    console.log('Result:', result);
                }
            """)
        except Exception as e:
            print(f"Error calling automateGrokChat: {e}")
        
        await page.wait_for_timeout(3000)
        
        # Check input content
        content = await page.evaluate("""
            () => {
                const textarea = document.querySelector('textarea[aria-label="Ask Grok anything"]');
                const contentEditable = document.querySelector('[contenteditable="true"]');
                if (textarea) return `Textarea: ${textarea.value}`;
                if (contentEditable) return `ContentEditable: ${contentEditable.textContent}`;
                return 'No input found';
            }
        """)
        print(f"Input content after injection: {content}")
        
        await page.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(test_providers())