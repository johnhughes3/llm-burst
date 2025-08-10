"""Claude site automation JavaScript selectors and functions."""

SUBMIT_JS = """
(function() {
window.automateClaudeInteraction = function(promptText, enableResearchStr) {
  const enableResearch = enableResearchStr === 'Yes';
  console.log('Starting Claude automation' + (enableResearch ? ' with Research enabled' : ''));
  
  return new Promise((resolve, reject) => {
    // Check for login page first
    if (document.querySelector('input[type="email"]') ||
        document.querySelector('form[action*="login"]') ||
        document.title.toLowerCase().includes('log in') ||
        document.title.toLowerCase().includes('sign up')) {
      return reject('Login page detected. Please log in to Claude first.');
    }

    // Step 1: Enable research mode if requested
    let automationChain = Promise.resolve();
    
    if (enableResearch) {
      automationChain = automationChain.then(() => {
        return new Promise((innerResolve) => {
          try {
            const allButtons = Array.from(document.querySelectorAll('button'));
            const researchButton = allButtons.find(b => (b.textContent || '').includes('Research'));
            if (researchButton) {
              console.log('Found Research button, clicking...');
              researchButton.click();
              setTimeout(innerResolve, 500);
              return;
            }
            const betaTags = Array.from(document.querySelectorAll('.uppercase'));
            const parentBtn = betaTags.find(t => (t.textContent || '').includes('beta'))?.closest?.('button');
            if (parentBtn) {
              console.log('Found Research button via beta tag, clicking...');
              parentBtn.click();
              setTimeout(innerResolve, 500);
              return;
            }
            console.log('Research button not found, continuing...');
            innerResolve();
          } catch (e) {
            console.log('Research toggle failed, continuing:', e);
            innerResolve();
          }
        });
      });
    }

    // Step 2: Insert text and submit
    automationChain.then(() => {
      try {
        const editor = document.querySelector('.ProseMirror');
        if (!editor) {
          return reject('Claude editor element (.ProseMirror) not found');
        }
        
        console.log('Found editor, focusing and inserting text...');
        editor.focus();
        
        // Clear any existing content
        editor.innerHTML = '';
        
        // Insert text as paragraphs (similar to Gemini approach)
        const lines = promptText.split('\\n');
        lines.forEach(line => {
          const p = document.createElement('p');
          p.textContent = line || '\\u00A0';  // Use non-breaking space for empty lines
          editor.appendChild(p);
        });
        
        // Dispatch input event to update the UI
        editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        console.log('Text inserted, looking for send button...');
        
        // Wait a moment for the send button to become enabled
        setTimeout(() => {
          // Find send button - try multiple selectors
          let sendButton = document.querySelector('button[aria-label="Send message"]') ||
                           document.querySelector('button[aria-label*="Send"]') ||
                           document.querySelector('button svg.lucide-arrow-up')?.closest('button');
          
          if (!sendButton) {
            return reject('Claude send button not found');
          }
          
          if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
            console.log('Send button is disabled, waiting longer...');
            // Try again with another input event
            editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            
            setTimeout(() => {
              if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                return reject('Claude send button is still disabled after waiting');
              }
              sendButton.click();
              console.log('Send button clicked after extra wait');
              resolve();
            }, 800);
          } else {
            sendButton.click();
            console.log('Send button clicked');
            resolve();
          }
        }, 500);
      } catch (e) {
        reject(`Claude automation failed: ${e}`);
      }
    }).catch(reject);
  });
}
})();
"""

FOLLOWUP_JS = r"""
(function() {
window.claudeFollowUpMessage = function(promptText) {
  return new Promise((resolve, reject) => {
    try {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) {
        return reject('Claude editor element (.ProseMirror) not found for follow-up');
      }
      
      console.log('Found editor for follow-up, focusing and inserting text...');
      editor.focus();
      editor.innerHTML = '';
      
      // Insert text as paragraphs
      const lines = promptText.split('\\n');
      lines.forEach(line => {
        const p = document.createElement('p');
        p.textContent = line || '\\u00A0';
        editor.appendChild(p);
      });
      
      // Dispatch input event
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      
      // Scroll to bottom to ensure visibility
      try {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      } catch (e) { /* no-op */ }
      
      // Wait and click send button
      setTimeout(() => {
        let sendButton = document.querySelector('button[aria-label="Send message"]') ||
                         document.querySelector('button[aria-label*="Send"]') ||
                         document.querySelector('button svg.lucide-arrow-up')?.closest('button');
        
        if (!sendButton) {
          return reject('Claude send button not found for follow-up');
        }
        
        if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
          editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          setTimeout(() => {
            sendButton.click();
            console.log('Follow-up sent after extra wait');
            resolve();
          }, 800);
        } else {
          sendButton.click();
          console.log('Follow-up sent');
          resolve();
        }
      }, 500);
    } catch (error) {
      reject(`Error in Claude follow-up: ${error}`);
    }
  });
}
})();
"""


async def selectors_up_to_date(page) -> bool:
    """Quick test to verify Claude UI hasn't changed."""
    try:
        # Check for key selectors
        result = await page.evaluate(
            """
            () => {
                const editor = document.querySelector('.ProseMirror');
                const sendButton = document.querySelector('button[aria-label="Send message"]');
                return editor !== null && sendButton !== null;
            }
        """
        )
        return bool(result)
    except Exception:
        return False
