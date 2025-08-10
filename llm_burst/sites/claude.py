"""Claude site automation JavaScript selectors and functions."""

SUBMIT_JS = """
window.automateClaudeInteraction = function(messageText, enableResearch) {
  return new Promise((resolve, reject) => {
    try {
        // Check for login page
        if (document.querySelector('input[type="email"]') || document.title.toLowerCase().includes('sign in')) {
            return reject('Login page detected. Please log in to Claude first.');
        }

        const editorElement = document.querySelector('.ProseMirror');
        if (!editorElement) {
          console.error('Claude editor element not found');
          return reject('Editor element not found');
        }
        editorElement.focus();
        editorElement.innerHTML = ''; // Clear

        const lines = messageText.split('\n');
        lines.forEach(line => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0';
          editorElement.appendChild(p);
        });

        const inputEvent = new Event('input', { bubbles: true });
        editorElement.dispatchEvent(inputEvent);

        setTimeout(() => {
          const sendButton = document.querySelector('button[data-testid="send-button"]');
          if (!sendButton) {
            // Fallback for different versions
            const alternativeButton = document.querySelector('button[aria-label="Send message"]');
            if(!alternativeButton) {
                return reject('Send button not found');
            }
            if (alternativeButton.disabled) {
                return reject('Send button is disabled');
            }
            alternativeButton.click();
            resolve();
            return;
          }
          if (sendButton.disabled) {
            return reject('Send button is disabled');
          }
          sendButton.click();
          resolve();
        }, 500);
    } catch (error) {
        console.error(`Error in automateClaudeInteraction: ${error}`);
        reject(`Error adding text or sending: ${error}`);
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
        result = page.evaluate(
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
