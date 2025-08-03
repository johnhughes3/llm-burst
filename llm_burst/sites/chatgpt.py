"""ChatGPT site automation JavaScript selectors and functions."""

SUBMIT_JS = """
function tryFind(selector, description) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            console.warn(`${description} not found with selector: ${selector}`);
            return null;
        }
        return element;
    } catch (error) {
        console.error(`Error finding ${description}: ${error.message}`);
        return null;
    }
}

function automateOpenAIChat(messageText, useResearch, useIncognito) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting ChatGPT automation. Research mode: ${useResearch}, Incognito mode: ${useIncognito}`);
      
      // INCOGNITO MODE HANDLING
      if (useIncognito === 'Yes') {
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
        
        setTimeout(() => {
          handleResearchAndPrompt();
        }, 800);
      } else {
        handleResearchAndPrompt();
      }
      
      function handleResearchAndPrompt() {
        // RESEARCH MODE HANDLING
        if (useResearch === 'Yes') {
          console.log('Research mode requested. Attempting to enable...');
          
          clickToolsDropdownAndSelectDeepResearch()
            .then(success => {
              if (success) {
                console.log('Research mode enabled successfully');
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
          submitPrompt();
        }
      }
      
      async function clickToolsDropdownAndSelectDeepResearch() {
        console.log('🚀 Attempting to enable deep research...');
        
        function sleep(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }
        
        try {
          const toolsButton = tryFind('#system-hint-button', 'tools button');
          if (!toolsButton) {
            console.log('Tools button not found');
            return false;
          }
          
          console.log('Found Tools button');
          
          const isOpen = toolsButton.getAttribute('aria-expanded') === 'true';
          if (!isOpen) {
            console.log('Opening Tools dropdown...');
            toolsButton.click();
            await sleep(500);
          }
          
          await sleep(500);
          
          const menuItems = document.querySelectorAll('div[role="menuitemradio"]');
          console.log(`Found ${menuItems.length} menu items`);
          
          let targetItem = null;
          for (let i = 0; i < menuItems.length; i++) {
            const text = menuItems[i].textContent?.trim() || '';
            if (text.includes('Run deep research')) {
              targetItem = menuItems[i];
              console.log(`Found "Run deep research" at position ${i + 1}`);
              break;
            }
          }
          
          if (!targetItem && menuItems.length >= 4) {
            targetItem = menuItems[3];
            console.log('Using 4th menu item as fallback');
          }
          
          if (targetItem) {
            console.log('Clicking deep research option...');
            targetItem.click();
            await sleep(1000);
            
            const finalState = toolsButton.getAttribute('aria-expanded');
            if (finalState === 'false') {
              console.log('Deep research enabled successfully!');
              return true;
            }
          }
          
          console.log('Direct click failed, trying keyboard approach...');
          return await keyboardApproach();
          
        } catch (error) {
          console.log('Error in dropdown approach:', error);
          return false;
        }
      }
      
      async function keyboardApproach() {
        try {
          const toolsButton = tryFind('#system-hint-button', 'tools button');
          if (!toolsButton) return false;
          
          console.log('Using keyboard navigation...');
          
          toolsButton.focus();
          await new Promise(resolve => setTimeout(resolve, 200));
          
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
          
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter', 
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true
          });
          
          document.activeElement.dispatchEvent(enterEvent);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const finalState = toolsButton.getAttribute('aria-expanded');
          return finalState === 'false';
          
        } catch (error) {
          console.log('Keyboard approach failed:', error);
          return false;
        }
      }
      
      function submitPrompt() {
        const editorElement = tryFind('.ProseMirror', 'ChatGPT editor');
        if (!editorElement) {
          reject('Editor element not found');
          return;
        }
        
        console.log('Found editor element');
        
        editorElement.focus();
        editorElement.innerHTML = '';
        
        const paragraph = document.createElement('p');
        paragraph.textContent = messageText;
        
        editorElement.appendChild(paragraph);
        
        const inputEvent = new Event('input', { bubbles: true });
        editorElement.dispatchEvent(inputEvent);
        
        console.log('Text added to input');
        
        setTimeout(() => {
          const sendButton = tryFind('button[data-testid="send-button"]', 'send button');
          if (!sendButton) {
            reject('Send button not found');
            return;
          }
          
          console.log('Found send button');
          
          if (sendButton.disabled) {
            console.log('Send button is disabled, waiting longer...');
            setTimeout(() => {
              if (sendButton.disabled) {
                reject('Send button is still disabled after waiting');
                return;
              }
              sendButton.click();
              console.log('Send button clicked');
              resolve();
            }, 1000);
            return;
          }
          
          sendButton.click();
          console.log('Send button clicked');
          resolve();
        }, 500);
      }
      
    } catch (error) {
      reject(`Error: ${error}`);
    }
  });
}
"""

FOLLOWUP_JS = """
function tryFind(selector, description) {
    try {
        const element = document.querySelector(selector);
        if (!element) {
            console.warn(`${description} not found with selector: ${selector}`);
            return null;
        }
        return element;
    } catch (error) {
        console.error(`Error finding ${description}: ${error.message}`);
        return null;
    }
}

function chatGPTFollowUpMessage(messageText) {
  return new Promise((resolve, reject) => {
    try {
      const editorElement = tryFind('#prompt-textarea', 'ChatGPT editor');
      if (!editorElement) {
        console.error('Editor element not found');
        reject('Editor element not found');
        return;
      }
      
      console.log('Found ChatGPT editor element');
      
      editorElement.focus();
      editorElement.innerHTML = '';
      editorElement.textContent = messageText;
      
      const inputEvent = new Event('input', { bubbles: true });
      editorElement.dispatchEvent(inputEvent);
      
      console.log('Follow-up text added to ChatGPT input');
      
      setTimeout(() => {
        const sendButton = tryFind('button[type="submit"]', 'submit button');
        if (!sendButton) {
          const alternativeSendButton = tryFind('[data-testid="send-button"]', 'send button');
          if (!alternativeSendButton) {
            reject('Send button not found');
            return;
          }
          
          if (alternativeSendButton.disabled) {
            reject('Send button is disabled');
            return;
          }
          
          alternativeSendButton.click();
          console.log('ChatGPT follow-up message sent successfully (alternative button)');
          resolve();
          return;
        }
        
        if (sendButton.disabled) {
          reject('Send button is disabled');
          return;
        }
        
        sendButton.click();
        console.log('ChatGPT follow-up message sent successfully');
        resolve();
      }, 500);
    } catch (error) {
      reject(`Error: ${error}`);
    }
  });
}
"""

def selectors_up_to_date(page) -> bool:
    """Quick test to verify ChatGPT UI hasn't changed."""
    try:
        # Check for key selectors
        result = page.evaluate("""
            () => {
                const editor = document.querySelector('.ProseMirror') || document.querySelector('#prompt-textarea');
                const sendButton = document.querySelector('button[type="submit"]') || 
                                  document.querySelector('[data-testid="send-button"]');
                return editor !== null && sendButton !== null;
            }
        """)
        return result
    except Exception:
        return False