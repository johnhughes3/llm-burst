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
          console.log('Research mode requested. Enabling deep research mode...');
          
          // Enable deep research mode (navigation handled in Python)
          enableDeepResearchMode()
            .then(success => {
              if (success) {
                console.log('Deep research mode enabled successfully');
                // Wait a moment for research mode to activate
                setTimeout(submitPrompt, 1200);
              } else {
                console.warn('Could not enable deep research mode. Continuing with standard mode...');
                submitPrompt();
              }
            })
            .catch(error => {
              console.warn('Error enabling deep research mode:', error);
              submitPrompt();
            });
        } else {
          // No research mode, continue to submit the prompt
          submitPrompt();
        }
      }
      
      // NEW: Function to enable deep research mode using plus button
      async function enableDeepResearchMode() {
        console.log('🚀 Attempting to enable deep research mode...');
        
        function sleep(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }
        
        // Helper to wait for element
        async function waitForElement(selector, timeout = 5000) {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await sleep(100);
          }
          return null;
        }
        
        try {
          // Method 1: Try plus button approach with fallback selectors
          const plusButton = document.querySelector(
            '[data-testid="composer-plus-btn"], ' +
            'button[aria-label*="More" i], ' +
            'button[aria-label*="Attach" i], ' +
            'button[aria-label*="Plus" i]'
          );
          
          if (plusButton) {
            console.log('Found plus button, clicking...');
            plusButton.click();
            
            // Wait for menu to appear
            const menu = await waitForElement('[role="menu"], [data-radix-portal], [role="listbox"]', 3000);
            if (!menu) {
              console.log('Menu did not appear after clicking plus button');
              return await slashCommandFallback();
            }
            
            // Find and click "Deep research" option in the menu
            const menuItems = document.querySelectorAll(
              '[role="menuitemradio"], [role="menuitem"], [data-testid*="menu-item" i]'
            );
            console.log(`Found ${menuItems.length} menu items`);
            
            // Find the Deep research option
            let deepResearchOption = null;
            for (const item of menuItems) {
              const text = item.textContent?.trim() || '';
              if (text.toLowerCase().includes('deep research') || 
                  text.toLowerCase().includes('research')) {
                deepResearchOption = item;
                console.log(`Found Deep research option: "${text}"`);
                break;
              }
            }
            
            if (deepResearchOption) {
              console.log('Clicking Deep research option...');
              deepResearchOption.click();
              
              // Wait and verify activation
              await sleep(500);
              
              // Check for activation indicators
              const indicators = document.querySelectorAll(
                '[aria-checked="true"], ' +
                '[data-state="checked"], ' +
                '.composer-mode-pill, ' +
                '[data-testid*="research-active"]'
              );
              
              if (indicators.length > 0) {
                console.log('Deep research mode verified as active!');
                await sleep(500); // Give UI time to stabilize
                return true;
              } else {
                console.log('Deep research mode enabled (no verification indicator found)');
                return true;
              }
            } else {
              console.log('Deep research option not found in menu');
            }
          } else {
            console.log('Plus button not found with any selector');
          }
          
          // Method 2: Fallback to slash command approach
          console.log('Trying slash command fallback...');
          return await slashCommandFallback();
          
        } catch (error) {
          console.log('Error enabling deep research mode:', error);
          return false;
        }
      }
      
      // Slash command fallback for deep research
      async function slashCommandFallback() {
        try {
          console.log('Using slash command approach...');
          
          function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
          }
          
          // Helper to wait for element
          async function waitForElement(selector, timeout = 5000) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
              const element = document.querySelector(selector);
              if (element) return element;
              await sleep(100);
            }
            return null;
          }
          
          // Find the text area with better selectors
          const textArea = document.querySelector(
            '#prompt-textarea, ' +
            '[data-testid="prompt-textarea"], ' +
            '.ProseMirror, ' +
            '[role="paragraph"]'
          );
          
          if (!textArea) {
            console.log('Text area not found for slash command');
            return false;
          }
          
          console.log('Found text area, focusing and typing slash...');
          
          // Click to focus the text area
          textArea.click();
          textArea.focus();
          await sleep(200);
          
          // Clear any existing content
          textArea.innerHTML = '';
          
          // Dispatch proper events for slash command
          // First, dispatch beforeinput event
          const beforeInputEvent = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: '/',
            bubbles: true,
            cancelable: true
          });
          textArea.dispatchEvent(beforeInputEvent);
          
          // Set the content
          textArea.textContent = '/';
          
          // Dispatch input event
          const inputEvent = new InputEvent('input', {
            inputType: 'insertText',
            data: '/',
            bubbles: true
          });
          textArea.dispatchEvent(inputEvent);
          
          // Also dispatch keydown for React/ProseMirror
          const keydownEvent = new KeyboardEvent('keydown', {
            key: '/',
            code: 'Slash',
            keyCode: 191,
            bubbles: true,
            cancelable: true
          });
          textArea.dispatchEvent(keydownEvent);
          
          // Wait for command menu to appear
          const commandMenu = await waitForElement(
            '[role="listbox"], ' +
            '[role="menu"], ' +
            '[data-radix-portal], ' +
            '.command-menu, ' +
            '[data-testid*="command-menu"]',
            3000
          );
          
          if (!commandMenu) {
            console.log('Command menu did not appear after typing slash');
            // Clear the slash
            textArea.innerHTML = '';
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            return false;
          }
          
          console.log('Command menu appeared, looking for Deep research option...');
          
          // Look for Deep research option within the command menu
          const menuItems = commandMenu.querySelectorAll(
            '[role="option"], ' +
            '[role="menuitem"], ' +
            '[data-testid*="menu-item"], ' +
            'div[class*="item"], ' +
            'button'
          );
          
          let deepResearchOption = null;
          for (const item of menuItems) {
            const text = item.textContent?.trim() || '';
            if (text.toLowerCase().includes('deep research') || 
                text.toLowerCase() === 'deep research') {
              deepResearchOption = item;
              console.log(`Found Deep research option: "${text}"`);
              break;
            }
          }
          
          if (deepResearchOption) {
            console.log('Clicking Deep research option...');
            deepResearchOption.click();
            await sleep(1000);
            console.log('Deep research enabled via slash command!');
            return true;
          } else {
            console.log('Deep research option not found in command menu');
            // Clear the slash from the text area
            textArea.innerHTML = '';
            textArea.dispatchEvent(new Event('input', { bubbles: true }));
            return false;
          }
          
        } catch (error) {
          console.log('Slash command approach failed:', error);
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
