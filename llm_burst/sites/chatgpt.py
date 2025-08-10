"""ChatGPT site automation JavaScript selectors and functions."""

# JavaScript for initial prompt submission (activate command)
SUBMIT_JS = r"""
(function() {
  window.automateOpenAIChat = function(messageText, useResearch, useIncognito) {
    return new Promise((resolve, reject) => {
    try {
      console.log(`Starting ChatGPT automation. Research mode: ${useResearch}, Incognito mode: ${useIncognito}`);
      
      // INCOGNITO MODE HANDLING - Using exact working example
      if (useIncognito === 'Yes') {
        // Find all buttons and click the one containing "Temporary" text
        const buttons = document.querySelectorAll('button');
        let found = false;
        for (const button of buttons) {
            if (button.textContent.includes('Temporary')) {
                button.click();
                console.log("Temporary button clicked successfully");
                found = true;
                break;
            }
        }
        if (!found) {
            console.log("Button not found");
        }
        
        // Add a small delay after clicking without using await
        setTimeout(() => {
          // Continue with research mode after delay
          handleResearchAndPrompt();
        }, 800);
      } else {
        // Skip directly to research mode
        handleResearchAndPrompt();
      }
      
      // Function to handle research mode and prompt input
      function handleResearchAndPrompt() {
        // RESEARCH MODE HANDLING (updated logic for new UI)
        if (useResearch === 'Yes') {
          console.log('Research mode requested. Attempting to enable...');
          
          // NEW: Use dropdown-based approach for the updated UI
          clickToolsDropdownAndSelectDeepResearch()
            .then(success => {
              if (success) {
                console.log('Research mode enabled successfully');
                // Wait a moment for research mode to activate
                setTimeout(submitPrompt, 1200);
              } else {
                console.warn('Research button not found. Continuing without research mode...');
                submitPrompt();
              }
            })
            .catch(error => {
              console.warn('Error enabling research mode:', error);
              submitPrompt();
            });
        } else {
          // No research mode, continue to submit the prompt
          submitPrompt();
        }
      }
      
      // NEW: Updated function to click "Run deep research" from Tools dropdown
      async function clickToolsDropdownAndSelectDeepResearch() {
        console.log('🚀 Attempting to enable deep research...');
        
        function sleep(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }
        
        try {
          // Find the Tools button
          const toolsButton = document.querySelector('#system-hint-button');
          if (!toolsButton) {
            console.log('Tools button not found');
            return false;
          }
          
          console.log('Found Tools button');
          
          // Open dropdown if not already open
          const isOpen = toolsButton.getAttribute('aria-expanded') === 'true';
          if (!isOpen) {
            console.log('Opening Tools dropdown...');
            toolsButton.click();
            await sleep(500);
          }
          
          // Wait for menu to render
          await sleep(500);
          
          // Try direct click approach first
          const menuItems = document.querySelectorAll('div[role="menuitemradio"]');
          console.log(`Found ${menuItems.length} menu items`);
          
          // Find "Run deep research" item
          let targetItem = null;
          for (let i = 0; i < menuItems.length; i++) {
            const text = menuItems[i].textContent?.trim() || '';
            if (text.includes('Run deep research')) {
              targetItem = menuItems[i];
              console.log(`Found "Run deep research" at position ${i + 1}`);
              break;
            }
          }
          
          // Fallback to 4th item
          if (!targetItem && menuItems.length >= 4) {
            targetItem = menuItems[3];
            console.log('Using 4th menu item as fallback');
          }
          
          if (targetItem) {
            console.log('Clicking deep research option...');
            targetItem.click();
            await sleep(1000);
            
            // Check if dropdown closed (success indicator)
            const finalState = toolsButton.getAttribute('aria-expanded');
            if (finalState === 'false') {
              console.log('Deep research enabled successfully!');
              return true;
            }
          }
          
          // If direct click failed, try keyboard approach
          console.log('Direct click failed, trying keyboard approach...');
          return await keyboardApproach();
          
        } catch (error) {
          console.log('Error in dropdown approach:', error);
          return false;
        }
      }
      
      // Keyboard fallback for deep research
      async function keyboardApproach() {
        try {
          const toolsButton = document.querySelector('#system-hint-button');
          if (!toolsButton) return false;
          
          console.log('Using keyboard navigation...');
          
          // Focus the tools button
          toolsButton.focus();
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Navigate to "Run deep research" (4th item) using arrow keys
          for (let i = 0; i < 4; i++) {
            const arrowEvent = new KeyboardEvent('keydown', {
              key: 'ArrowDown',
              code: 'ArrowDown',
              keyCode: 40,
              bubbles: true,
              cancelable: true
            });
            
            document.activeElement.dispatchEvent(arrowEvent);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          // Press Enter to select
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter', 
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true
          });
          
          document.activeElement.dispatchEvent(enterEvent);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Check success
          const finalState = toolsButton.getAttribute('aria-expanded');
          return finalState === 'false';
          
        } catch (error) {
          console.log('Keyboard approach failed:', error);
          return false;
        }
      }
      
      // Function to submit the prompt
      function submitPrompt() {
        // Find the editor element - try both selectors
        let editorElement = document.querySelector('#prompt-textarea');
        if (!editorElement) {
          editorElement = document.querySelector('.ProseMirror');
        }
        if (!editorElement) {
          reject('Editor element not found');
          return;
        }
        
        console.log('Found editor element');
        
        // Focus the editor
        editorElement.focus();
        
        // Clear existing content if any
        editorElement.innerHTML = '';
        
        // Create a paragraph element with the text
        const paragraph = document.createElement('p');
        paragraph.textContent = messageText;
        
        // Append the paragraph to the editor
        editorElement.appendChild(paragraph);
        
        // Dispatch multiple events to ensure the UI registers the change
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        const keyupEvent = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ' });
        
        editorElement.dispatchEvent(inputEvent);
        editorElement.dispatchEvent(changeEvent);
        editorElement.dispatchEvent(keyupEvent);
        
        // Also try to trigger React's synthetic event system
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set ||
                                       Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter && editorElement.value !== undefined) {
          nativeInputValueSetter.call(editorElement, messageText);
          editorElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        console.log('Text added to input');
        
        // Wait for send button with retry logic
        let attempts = 0;
        const maxAttempts = 5;
        const checkInterval = 500;
        
        const checkForSendButton = () => {
          attempts++;
          
          // Find the send button
          const sendButton = document.querySelector('button[data-testid="send-button"]');
          
          if (!sendButton) {
            if (attempts < maxAttempts) {
              setTimeout(checkForSendButton, checkInterval);
            } else {
              reject('Send button not found after multiple attempts');
            }
            return;
          }
          
          console.log('Found send button');
          
          // Check if the button is disabled
          if (sendButton.disabled) {
            if (attempts < maxAttempts) {
              console.log('Send button is disabled, waiting...');
              setTimeout(checkForSendButton, checkInterval);
            } else {
              reject('Send button is still disabled after waiting');
            }
            return;
          }
          
          // Click the send button
          sendButton.click();
          console.log('Send button clicked');
          resolve();
        };
        
        // Start checking after initial delay
        setTimeout(checkForSendButton, 1000); // Give time for the button to appear after text is entered
      }
      
    } catch (error) {
      reject(`Error: ${error}`);
    }
  });
  };
})();
"""

# JavaScript for follow-up messages
FOLLOWUP_JS = r"""
window.chatGPTFollowUpMessage = function(messageText) {
  return new Promise((resolve, reject) => {
    try {
      // Find the ProseMirror element (the editable div)
      const editorElement = document.querySelector('#prompt-textarea');
      if (!editorElement) {
        console.error('Editor element not found');
        reject('Editor element not found');
        return;
      }
      
      console.log('Found ChatGPT editor element');
      
      // Focus the editor
      editorElement.focus();
      
      // Clear existing content
      // This uses the innerHTML approach since it's contenteditable
      editorElement.innerHTML = '';
      
      // Set the text content
      editorElement.textContent = messageText;
      
      // Dispatch input event to ensure ChatGPT registers the change
      const inputEvent = new Event('input', { bubbles: true });
      editorElement.dispatchEvent(inputEvent);
      
      console.log('Follow-up text added to ChatGPT input');
      
      // Wait for send button with retry logic
      let attempts = 0;
      const maxAttempts = 5;
      const checkInterval = 500;
      
      const checkForSendButton = () => {
        attempts++;
        console.log(`Follow-up: Attempt ${attempts} to find send button...`);
        
        // Try primary selector first
        let sendButton = document.querySelector('[data-testid="send-button"]');
        
        // Fallback to submit button if primary not found
        if (!sendButton) {
          sendButton = document.querySelector('button[type="submit"]');
        }
        
        if (!sendButton) {
          if (attempts < maxAttempts) {
            console.log('Follow-up: Send button not found yet, retrying...');
            setTimeout(checkForSendButton, checkInterval);
          } else {
            reject('Send button not found after multiple attempts');
          }
          return;
        }
        
        console.log('Follow-up: Found send button');
        
        // Check if the button is disabled
        if (sendButton.disabled) {
          if (attempts < maxAttempts) {
            console.log('Follow-up: Send button is disabled, waiting...');
            setTimeout(checkForSendButton, checkInterval);
          } else {
            reject('Send button is still disabled after waiting');
          }
          return;
        }
        
        // Click the send button
        sendButton.click();
        console.log('ChatGPT follow-up message sent successfully');
        resolve();
      };
      
      // Start checking after initial delay
      setTimeout(checkForSendButton, 1000); // Give time for the button to appear after text is entered
    } catch (error) {
      reject(`Error: ${error}`);
    }
  });
}
"""


async def selectors_up_to_date(page) -> bool:
    """Quick test to verify ChatGPT UI hasn't changed."""
    try:
        # Check for editor element
        editor_check = await page.evaluate("""
            () => {
                const editor = document.querySelector('.ProseMirror') || 
                              document.querySelector('#prompt-textarea');
                return editor !== null;
            }
        """)
        
        if not editor_check:
            return False
        
        # Type some text to make send button appear
        await page.evaluate("""
            () => {
                const editor = document.querySelector('#prompt-textarea');
                if (editor) {
                    editor.focus();
                    editor.innerHTML = '<p>test</p>';
                    const inputEvent = new Event('input', { bubbles: true });
                    editor.dispatchEvent(inputEvent);
                }
            }
        """)
        
        # Wait a moment for UI to update
        await page.wait_for_timeout(500)
        
        # Now check for send button
        button_check = await page.evaluate("""
            () => {
                const sendButton = document.querySelector('[data-testid="send-button"]');
                return sendButton !== null && !sendButton.disabled;
            }
        """)
        
        # Clear the text we added
        await page.evaluate("""
            () => {
                const editor = document.querySelector('#prompt-textarea');
                if (editor) {
                    editor.innerHTML = '';
                    const inputEvent = new Event('input', { bubbles: true });
                    editor.dispatchEvent(inputEvent);
                }
            }
        """)
        
        return editor_check and button_check
    except Exception:
        return False
