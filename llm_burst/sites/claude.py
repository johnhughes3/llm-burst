"""Claude site automation JavaScript selectors and functions."""

SUBMIT_JS = """
window.tryFind = function(selector, description) {
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

window.automateClaudeInteraction = function(enableResearch) {
  console.log('Starting Claude automation' + (enableResearch ? ' with Research enabled' : ''));
  
  let automationChain = Promise.resolve();
  
  // Step 1: Enable research mode if requested
  if (enableResearch) {
    automationChain = automationChain.then(() => {
      return enableResearchMode();
    }).then(() => {
      console.log('Research mode enabled');
    });
  }
  
  // Step 2: Focus the input area (then let Keyboard Maestro handle the paste)
  automationChain = automationChain.then(() => {
    return focusInputArea();
  }).then(() => {
    console.log('Input area focused - ready for Keyboard Maestro paste');
  }).catch(error => {
    console.error('Automation failed:', error);
  });
}

window.enableResearchMode = function() {
  return new Promise((resolve, reject) => {
    try {
      console.log('Attempting to enable Research mode...');
      
      // Method 1: Find by text content
      const allButtons = Array.from(document.querySelectorAll('button'));
      const researchButton = allButtons.find(button => 
        button.textContent.includes('Research')
      );
      
      if (researchButton) {
        console.log('Research button found, clicking...');
        researchButton.click();
        setTimeout(resolve, 500);
        return;
      }
      
      // Method 2: Try finding by the beta tag
      const betaTags = Array.from(document.querySelectorAll('.uppercase'));
      const researchBetaParent = betaTags.find(tag => 
        tag.textContent.includes('beta')
      )?.closest('button');
      
      if (researchBetaParent) {
        console.log('Research button found via beta tag, clicking...');
        researchBetaParent.click();
        setTimeout(resolve, 500);
        return;
      }
      
      reject('Research button not found');
    } catch (error) {
      reject(`Error enabling research mode: ${error}`);
    }
  });
}

window.focusInputArea = function() {
  return new Promise((resolve, reject) => {
    try {
      const editor = tryFind('.ProseMirror', 'Claude editor');
      if (!editor) {
        reject('Editor element not found');
        return;
      }
      
      console.log('Found editor, focusing it for paste...');
      editor.focus();
      console.log('Editor focused - ready for paste');
      resolve();
      
    } catch (error) {
      reject(`Error focusing input area: ${error}`);
    }
  });
}
"""

FOLLOWUP_JS = r"""
window.claudeFollowUpMessage = function(messageText) {
  return new Promise((resolve, reject) => {
    try {
        // Find the ProseMirror element
        const editorElement = document.querySelector('.ProseMirror');
        if (!editorElement) {
          console.error('Claude editor element not found');
          reject('Editor element not found');
          return;
        }
        editorElement.focus();
        editorElement.innerHTML = ''; // Clear
        // Split text by line breaks and create proper paragraph elements
        const lines = messageText.split('\n');
        lines.forEach(line => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0'; // Use nbsp for empty lines
          editorElement.appendChild(p);
        });
        console.log('Follow-up text added as individual paragraphs');
        // Dispatch input event
        const inputEvent = new Event('input', { bubbles: true });
        editorElement.dispatchEvent(inputEvent);
        console.log('Input event dispatched');
        // Wait for send button (existing logic is fine)
        setTimeout(() => {
          const sendButton = document.querySelector('button[aria-label="Send message"]');
          if (!sendButton) {
            reject('Send button not found');
            return;
          }
          if (sendButton.disabled) {
             // Adding a retry mechanism similar to Gemini's for robustness
             console.log('Claude send button disabled, retrying...');
             setTimeout(() => {
                 if (sendButton.disabled) {
                     reject('Send button still disabled after retry');
                     return;
                 }
                 sendButton.click();
                 console.log('Follow-up message sent successfully after retry');
                 
                 // Scroll to bottom after 1 second
                 setTimeout(() => {
                   window.scrollTo({
                     top: document.documentElement.scrollHeight,
                     behavior: 'smooth'
                   });
                   console.log('Scrolled to bottom of page');
                 }, 1000);
                 
                 resolve();
             }, 500); // Wait another 500ms
             return;
          }
          sendButton.click();
          console.log('Follow-up message sent successfully');
          
          // Scroll to bottom after 1 second
          setTimeout(() => {
            window.scrollTo({
              top: document.documentElement.scrollHeight,
              behavior: 'smooth'
            });
            console.log('Scrolled to bottom of page');
          }, 1000);
          
          resolve();
        }, 500); // Initial timeout
    } catch (error) {
        console.error(`Error in claudeFollowUpMessage: ${error}`);
        reject(`Error adding text or sending: ${error}`);
    }
  });
}
"""


def selectors_up_to_date(page) -> bool:
    """Quick test to verify Claude UI hasn't changed."""
    try:
        # Check for key selectors
        result = page.evaluate("""
            () => {
                const editor = document.querySelector('.ProseMirror');
                const sendButton = document.querySelector('button[aria-label="Send message"]');
                return editor !== null && sendButton !== null;
            }
        """)
        return result
    except Exception:
        return False
