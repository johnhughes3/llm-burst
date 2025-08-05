#!/usr/bin/env python3
"""Debug script to test activate flow without swiftDialog."""

import asyncio
import json
import pyperclip
from llm_burst.constants import LLMProvider
from llm_burst.browser import BrowserAdapter
from llm_burst.providers import get_injector, InjectOptions
from llm_burst.chrome_bootstrap import ensure_remote_debugging


async def test_activate():
    """Test activate flow with debug output."""
    # Ensure Chrome is ready
    ensure_remote_debugging()
    
    # Get clipboard content
    try:
        prompt_text = pyperclip.paste()
        print(f"Clipboard content: {prompt_text[:50]}...")
    except Exception as e:
        prompt_text = "Test prompt"
        print(f"Error getting clipboard: {e}")
    
    if not prompt_text.strip():
        prompt_text = "Test prompt"
    
    providers = [LLMProvider.GEMINI, LLMProvider.GROK]  # Focus on problem providers
    
    async with BrowserAdapter() as adapter:
        for prov in providers:
            print(f"\n=== Testing {prov.name} ===")
            try:
                # Open window
                handle = await adapter.open_window(f"test-{prov.name}", prov)
                print(f"Window opened: {handle.live.window_id}")
                
                # Prepare injection
                opts = InjectOptions(
                    follow_up=False,
                    research=False,
                    incognito=False,
                )
                
                # Get injector and inject
                injector = get_injector(prov)
                
                # Add debug logging to page
                await handle.page.on("console", lambda msg: print(f"[{prov.name} Console] {msg.text}"))
                
                print(f"Injecting prompt: {prompt_text}")
                await injector(handle.page, prompt_text, opts)
                
                # Wait a bit to see results
                await asyncio.sleep(3)
                
                # Check if text was inserted
                if prov == LLMProvider.GEMINI:
                    result = await handle.page.evaluate("""
                        () => {
                            const editor = document.querySelector('.ql-editor');
                            return editor ? editor.textContent : 'No editor found';
                        }
                    """)
                    print(f"Gemini editor content: {result}")
                elif prov == LLMProvider.GROK:
                    result = await handle.page.evaluate("""
                        () => {
                            const textarea = document.querySelector('textarea[aria-label="Ask Grok anything"]');
                            const contentEditable = document.querySelector('[contenteditable="true"]');
                            if (textarea) return `Textarea: ${textarea.value}`;
                            if (contentEditable) return `ContentEditable: ${contentEditable.textContent}`;
                            return 'No input found';
                        }
                    """)
                    print(f"Grok input content: {result}")
                    
            except Exception as e:
                print(f"Error with {prov.name}: {e}")
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_activate())