"""Gemini site automation JavaScript selectors and functions."""

# JavaScript for initial prompt submission (activate command)
SUBMIT_JS = r"""
window.automateGeminiChat = function(messageText, enableResearch) {
  return new Promise((resolve, reject) => {
    try {
      // Step 1: Check if we need to enable Deep Research first
      if (enableResearch === 'Yes') {
        console.log('Research mode requested, will enable Deep Research first');
        // Enable research before model selection to avoid dropdown conflicts
        window.enableDeepResearch(() => {
          // Continue with model selection after enabling research
          window.selectModelAndProceed(messageText, resolve, reject);
        }, () => {
          // If research enabling fails, still try to continue with model selection
          console.log('Could not enable Deep Research, continuing with model selection');
          window.selectModelAndProceed(messageText, resolve, reject);
        });
      } else {
        // Skip research step, go directly to model selection
        console.log('Regular mode requested, proceeding to model selection');
        window.selectModelAndProceed(messageText, resolve, reject);
      }
    } catch (error) {
      reject(`Error in automation process: ${error}`);
    }
  });
}

window.enableDeepResearch = function(onSuccess, onFailure) {
  try {
    // Method 1: Try toolbar button first
    const toolbarButtons = Array.from(document.querySelectorAll('button.toolbox-drawer-item-button'))
      .filter(button => {
        const labelDiv = button.querySelector('.toolbox-drawer-button-label');
        return labelDiv && labelDiv.textContent.trim() === 'Deep Research';
      });
    
    if (toolbarButtons.length > 0) {
      console.log('Found Deep Research button in toolbar, clicking it');
      toolbarButtons[0].click();
      
      // Wait for button action to take effect
      setTimeout(onSuccess, 500);
      return;
    }
    
    // Method 2: Try button with the icon
    const iconButtons = Array.from(document.querySelectorAll('button'))
      .filter(button => {
        const icon = button.querySelector('mat-icon[data-mat-icon-name="travel_explore"]');
        return icon !== null;
      });
    
    if (iconButtons.length > 0) {
      console.log('Found Deep Research button by icon, clicking it');
      iconButtons[0].click();
      
      setTimeout(onSuccess, 500);
      return;
    }
    
    // Method 3: Any button containing Deep Research text
    const anyButtons = Array.from(document.querySelectorAll('button'))
      .filter(button => {
        const text = button.textContent || '';
        return text.includes('Deep Research');
      });
    
    if (anyButtons.length > 0) {
      console.log('Found Deep Research button by text content, clicking it');
      anyButtons[0].click();
      
      setTimeout(onSuccess, 500);
      return;
    }
    
    console.log('Could not find Deep Research button');
    onFailure();
  } catch (error) {
    console.error(`Error enabling Deep Research: ${error}`);
    onFailure();
  }
}

window.selectModelAndProceed = function(messageText, resolve, reject) {
  try {
    // Find and click the model selector button
    console.log('Looking for model selector button');
    
    // Find buttons that might be the model selector
    const possibleModelButtons = Array.from(document.querySelectorAll('button'))
      .filter(button => {
        const text = button.textContent || '';
        return (
          text.includes('Gemini') || 
          text.includes('2.5 Pro') || 
          text.includes('Advanced')
        );
      });
    
    const modelButton = possibleModelButtons[0];
    
    if (!modelButton) {
      console.log('Model selector button not found, proceeding with current model');
      // Skip to adding text
      window.addTextAndSend(messageText, resolve, reject);
      return;
    }
    
    console.log('Found model selector button, clicking it');
    modelButton.click();
    
    // Wait for dropdown to appear and click 2.5 Pro option
    setTimeout(() => {
      console.log('Looking for 2.5 Pro button in dropdown');
      
      // Find 2.5 Pro button in the dropdown
      const proButtons = Array.from(document.querySelectorAll('button'))
        .filter(button => {
          const text = button.textContent || '';
          return text.includes('2.5 Pro');
        });
      
      const proButton = proButtons[0];
      
      if (!proButton) {
        console.log('2.5 Pro button not found, proceeding with current model');
        // Click somewhere else to close the dropdown
        document.body.click();
        setTimeout(() => {
          window.addTextAndSend(messageText, resolve, reject);
        }, 300);
        return;
      }
      
      console.log('Found 2.5 Pro button, clicking it');
      proButton.click();
      
      // Wait for model selection to apply and dropdown to close
      setTimeout(() => {
        window.addTextAndSend(messageText, resolve, reject);
      }, 500);
    }, 500);
  } catch (error) {
    reject(`Error selecting model: ${error}`);
  }
}

window.addTextAndSend = function(messageText, resolve, reject) {
  try {
    // Find the editable text area
    const editor = document.querySelector('.ql-editor');
    if (!editor) {
      reject('Editor element not found');
      return;
    }
    console.log('Found editor element');
    
    // Focus the editor
    editor.focus();
    
    // Clear existing content - use DOM methods instead of innerHTML
    while (editor.firstChild) {
      editor.removeChild(editor.firstChild);
    }
    
    // Split text into paragraphs and add them properly
    const lines = messageText.split('\n');
    lines.forEach(line => {
      const p = document.createElement('p');
      // Use non-breaking space for empty lines to maintain structure
      p.textContent = line || '\u00A0';
      editor.appendChild(p);
    });
    console.log('Text added as individual paragraphs');
    
    // Dispatch input event to ensure the UI updates
    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    console.log('Input event dispatched');
    
    // Wait for send button (using the slightly longer delay and retry logic)
    setTimeout(() => {
      const sendButton = document.querySelector('button.send-button');
      if (!sendButton) {
        reject('Send button not found');
        return;
      }
      console.log('Found send button');
      if (sendButton.getAttribute('aria-disabled') === 'true') {
        console.log('Send button is disabled, waiting longer...');
        setTimeout(() => {
          if (sendButton.getAttribute('aria-disabled') === 'true') {
            // Try dispatching another input event just before the final check
            editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            setTimeout(() => { // Nested timeout
              if (sendButton.getAttribute('aria-disabled') === 'true') {
                reject('Send button is still disabled after waiting and extra event');
                return;
              }
              sendButton.click();
              console.log('Send button clicked after extra wait');
              resolve();
            }, 500);
            return;
          }
          sendButton.click();
          console.log('Send button clicked after initial wait');
          resolve();
        }, 1000);
        return;
      }
      sendButton.click();
      console.log('Send button clicked');
      resolve();
    }, 750); // Initial wait after inserting text
  } catch (error) {
    reject(`Error adding text or sending: ${error}`);
  }
}

// Entry point
"""

# JavaScript for follow-up messages
FOLLOWUP_JS = r"""
window.geminiFollowUpMessage = function(messageText) {
  return new Promise((resolve, reject) => {
    try {
      // Find the editable text area
      const editor = document.querySelector('.ql-editor');
      if (!editor) {
        console.error('Gemini editor element not found');
        reject('Editor element not found');
        return;
      }
      console.log('Found Gemini editor element');

      editor.focus();
      // Clear existing content - use DOM methods instead of innerHTML
      while (editor.firstChild) {
        editor.removeChild(editor.firstChild);
      }

      // Split text into paragraphs and add them properly
      const lines = messageText.split('\n');
      lines.forEach(line => {
        const p = document.createElement('p');
        p.textContent = line || '\u00A0'; // Use non-breaking space for empty lines
        editor.appendChild(p);
      });
      console.log('Follow-up text added as individual paragraphs');

      // Dispatch input event
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      console.log('Input event dispatched');

      // Wait for send button (using the existing retry logic)
      const checkSendButton = () => {
        const sendButton = document.querySelector('.send-button');
        if (!sendButton) {
          reject('Send button not found');
          return;
        }
        const isDisabled =
          sendButton.getAttribute('aria-disabled') === 'true' ||
          sendButton.parentElement.classList.contains('disabled');

        if (isDisabled) {
          console.log('Send button is disabled, waiting...');
          setTimeout(checkSendButton, 300); // Keep checking
          return;
        }
        console.log('Send button enabled, clicking');
        sendButton.click();
        console.log('Gemini follow-up message sent successfully');
        resolve();
      };
      setTimeout(checkSendButton, 500); // Initial delay before checking

    } catch (error) {
        console.error(`Error in geminiFollowUpMessage: ${error}`);
        reject(`Error: ${error}`);
    }
  });
}

// Entry point
"""


async def selectors_up_to_date(page) -> bool:
    """Quick test to verify Gemini UI hasn't changed."""
    try:
        # Check for key selectors
        result = await page.evaluate("""
            () => {
                const editor = document.querySelector('.ql-editor');
                const sendButton = document.querySelector('button.send-button');
                return editor !== null && sendButton !== null;
            }
        """)
        return bool(result)
    except Exception:
        return False
