"""Gemini site automation JavaScript selectors and functions."""

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

function automateGeminiChat(messageText, enableResearch) {
  return new Promise((resolve, reject) => {
    try {
      // Step 1: Check if we need to enable Deep Research first
      if (enableResearch === 'Yes') {
        console.log('Research mode requested, will enable Deep Research first');
        enableDeepResearch(() => {
          selectModelAndProceed(messageText, resolve, reject);
        }, () => {
          console.log('Could not enable Deep Research, continuing with model selection');
          selectModelAndProceed(messageText, resolve, reject);
        });
      } else {
        console.log('Regular mode requested, proceeding to model selection');
        selectModelAndProceed(messageText, resolve, reject);
      }
    } catch (error) {
      reject(`Error in automation process: ${error}`);
    }
  });
}

function enableDeepResearch(onSuccess, onFailure) {
  try {
    // Method 1: Try toolbar button first
    const toolbarButtons = Array.from(document.querySelectorAll('button.toolbox-drawer-item-button'))
      .filter(button => {
        const labelDiv = tryFind('.toolbox-drawer-button-label', 'toolbar label');
        return labelDiv && labelDiv.textContent.trim() === 'Deep Research';
      });
    
    if (toolbarButtons.length > 0) {
      console.log('Found Deep Research button in toolbar, clicking it');
      toolbarButtons[0].click();
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
    
    console.log('Could not find Deep Research button');
    onFailure();
  } catch (error) {
    console.error(`Error enabling Deep Research: ${error}`);
    onFailure();
  }
}

function selectModelAndProceed(messageText, resolve, reject) {
  try {
    console.log('Looking for model selector button');
    
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
      addTextAndSend(messageText, resolve, reject);
      return;
    }
    
    console.log('Found model selector button, clicking it');
    modelButton.click();
    
    setTimeout(() => {
      console.log('Looking for 2.5 Pro button in dropdown');
      
      const proButtons = Array.from(document.querySelectorAll('button'))
        .filter(button => {
          const text = button.textContent || '';
          return text.includes('2.5 Pro');
        });
      
      const proButton = proButtons[0];
      
      if (!proButton) {
        console.log('2.5 Pro button not found, proceeding with current model');
        document.body.click();
        setTimeout(() => {
          addTextAndSend(messageText, resolve, reject);
        }, 300);
        return;
      }
      
      console.log('Found 2.5 Pro button, clicking it');
      proButton.click();
      
      setTimeout(() => {
        addTextAndSend(messageText, resolve, reject);
      }, 500);
    }, 500);
  } catch (error) {
    reject(`Error selecting model: ${error}`);
  }
}

function addTextAndSend(messageText, resolve, reject) {
  try {
    const editor = tryFind('.ql-editor', 'Gemini editor');
    if (!editor) {
      reject('Editor element not found');
      return;
    }
    console.log('Found editor element');
    
    editor.focus();
    editor.innerHTML = '';
    
    const lines = messageText.split('\\n');
    lines.forEach(line => {
      const p = document.createElement('p');
      p.textContent = line || '\\u00A0';
      editor.appendChild(p);
    });
    console.log('Text added as individual paragraphs');
    
    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    console.log('Input event dispatched');
    
    setTimeout(() => {
      const sendButton = tryFind('button.send-button', 'send button');
      if (!sendButton) {
        reject('Send button not found');
        return;
      }
      console.log('Found send button');
      
      if (sendButton.getAttribute('aria-disabled') === 'true') {
        console.log('Send button is disabled, waiting longer...');
        setTimeout(() => {
          if (sendButton.getAttribute('aria-disabled') === 'true') {
            editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            setTimeout(() => {
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
    }, 750);
  } catch (error) {
    reject(`Error adding text or sending: ${error}`);
  }
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

function geminiFollowUpMessage(messageText) {
  return new Promise((resolve, reject) => {
    try {
      const editor = tryFind('.ql-editor', 'Gemini editor');
      if (!editor) {
        console.error('Gemini editor element not found');
        reject('Editor element not found');
        return;
      }
      console.log('Found Gemini editor element');

      editor.focus();
      editor.innerHTML = '';

      const lines = messageText.split('\\n');
      lines.forEach(line => {
        const p = document.createElement('p');
        p.textContent = line || '\\u00A0';
        editor.appendChild(p);
      });
      console.log('Follow-up text added as individual paragraphs');

      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      console.log('Input event dispatched');

      const checkSendButton = () => {
        const sendButton = tryFind('.send-button', 'send button');
        if (!sendButton) {
          reject('Send button not found');
          return;
        }
        const isDisabled =
          sendButton.getAttribute('aria-disabled') === 'true' ||
          sendButton.parentElement.classList.contains('disabled');

        if (isDisabled) {
          console.log('Send button is disabled, waiting...');
          setTimeout(checkSendButton, 300);
          return;
        }
        console.log('Send button enabled, clicking');
        sendButton.click();
        console.log('Gemini follow-up message sent successfully');
        resolve();
      };
      setTimeout(checkSendButton, 500);

    } catch (error) {
        console.error(`Error in geminiFollowUpMessage: ${error}`);
        reject(`Error: ${error}`);
    }
  });
}
"""

def selectors_up_to_date(page) -> bool:
    """Quick test to verify Gemini UI hasn't changed."""
    try:
        # Check for key selectors
        result = page.evaluate("""
            () => {
                const editor = document.querySelector('.ql-editor');
                const sendButton = document.querySelector('button.send-button');
                return editor !== null && sendButton !== null;
            }
        """)
        return result
    except Exception:
        return False