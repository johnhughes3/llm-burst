"""Claude site automation JavaScript selectors and functions."""

SUBMIT_JS = """
(function() {
window.automateClaudeInteraction = function(enableResearchStr) {
  const enableResearch = enableResearchStr === 'Yes';
  console.log('Starting Claude automation' + (enableResearch ? ' with Research enabled' : ''));
  
  let automationChain = Promise.resolve();

  // Check for login page first
  automationChain = automationChain.then(() => {
    return new Promise((resolve, reject) => {
      if (document.querySelector('input[type="email"]') ||
          document.querySelector('form[action*="login"]') ||
          document.title.toLowerCase().includes('log in') ||
          document.title.toLowerCase().includes('sign up')) {
        reject('Login page detected. Please log in to Claude first.');
      } else {
        resolve();
      }
    });
  });

  // Step 1: Enable research mode if requested
  if (enableResearch) {
    automationChain = automationChain.then(() => {
      return new Promise((resolve) => {
        try {
          const allButtons = Array.from(document.querySelectorAll('button'));
          const researchButton = allButtons.find(b => (b.textContent || '').includes('Research'));
          if (researchButton) {
            researchButton.click();
            setTimeout(resolve, 500);
            return;
          }
          const betaTags = Array.from(document.querySelectorAll('.uppercase'));
          const parentBtn = (betaTags.find(t => (t.textContent || '').includes('beta')) || {}).closest?.('button');
          if (parentBtn) {
            parentBtn.click();
            setTimeout(resolve, 500);
            return;
          }
        } catch (e) {
          console.log('Research toggle failed, continuing:', e);
        }
        resolve();
      });
    });
  }

  // Step 2: Focus the input area (then let llm-burst handle the paste)
  automationChain = automationChain.then(() => {
    return new Promise((resolve, reject) => {
      try {
        const editor = document.querySelector('.ProseMirror');
        if (!editor) {
          reject('Editor element not found');
          return;
        }
        editor.focus();
        editor.innerHTML = '';
        resolve();
      } catch (err) {
        reject(`Error focusing input area: ${err}`);
      }
    });
  }).catch(error => {
    console.error('Automation failed:', error);
    return Promise.reject(error);
  });

  return automationChain;
}
})();
"""

FOLLOWUP_JS = r"""
(function() {
window.claudeFollowUpMessage = function() {
  return new Promise((resolve, reject) => {
    try {
      const editorElement = document.querySelector('.ProseMirror');
      if (!editorElement) {
        reject('Editor element not found');
        return;
      }
      editorElement.focus();
      editorElement.innerHTML = '';
      try {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      } catch (e) { /* no-op */ }
      resolve();
    } catch (error) {
      reject(`Error preparing for follow-up: ${error}`);
    }
  });
}
})();
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
