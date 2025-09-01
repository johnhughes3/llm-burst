/**
 * LLM Burst - Gemini Injector
 * Ported from llm_burst/sites/gemini.py (SUBMIT_JS and FOLLOWUP_JS).
 *
 * Exposes:
 *   window.llmBurst.injectors.GEMINI = {
 *     submit: async ({ prompt, options: { research?: boolean }}),
 *     followup: async ({ prompt })
 *   }
 */
(function() {
  'use strict';

  const ns = (window.llmBurst = window.llmBurst || {});
  ns.injectors = ns.injectors || {};
  const u = ns.utils || {};

  const wait = u.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0)));
  const waitUntil = u.waitUntil || ((condition, timeout = 5000, interval = 100) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        let result = null;
        try { result = condition(); } catch { /* ignore */ }
        if (result) return resolve(result);
        if (Date.now() - start >= timeout) return reject(new Error('Timeout waiting for condition'));
        setTimeout(tick, interval);
      };
      tick();
    });
  });

  async function ensureEditorReady(timeout = 15000) {
    try {
      return await waitUntil(() => document.querySelector('.ql-editor'), timeout, 100);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Ported logic: automateGeminiChat + helpers (submit)
  // ---------------------------------------------------------------------------
  function enableDeepResearch(onSuccess, onFailure) {
    try {
      // First click the Tools button to open the tools panel
      const toolsButton = document.querySelector('button[aria-label="Tools"]') ||
                         Array.from(document.querySelectorAll('button')).find(b => {
                           const text = b.textContent || '';
                           return text.trim() === 'Tools' || text.includes('Tools');
                         });
      
      if (toolsButton) {
        console.log('Found Tools button, clicking to open tools panel');
        toolsButton.click();
        
        // Set a timeout to prevent hanging if panel doesn't appear
        const panelTimeout = setTimeout(() => {
          console.log('Tools panel timeout - trying fallback methods');
          onFailure();
        }, 3000); // 3 second timeout for panel to appear
        
        // Wait for the tools panel to appear and find Deep Research
        setTimeout(() => {
          clearTimeout(panelTimeout); // Clear timeout if we reach this point
          
          // Look for Deep Research button in the panel
          const deepResearchButton = Array.from(document.querySelectorAll('button')).find(button => {
            const text = button.textContent || '';
            // Look for button with "Deep Research" text or travel_explore icon
            const hasText = text.includes('Deep Research');
            const hasIcon = button.querySelector('img[src*="travel_explore"], svg[data-icon*="travel"], [aria-label*="Deep Research"]');
            return hasText || hasIcon;
          });
          
          if (deepResearchButton) {
            console.log('Found Deep Research button in tools panel, clicking it');
            deepResearchButton.click();
            setTimeout(onSuccess, 500);
          } else {
            console.log('Deep Research button not found in tools panel');
            // Try fallback methods
            
            // Method 2: Try button with the travel_explore icon directly
            const iconButtons = Array.from(document.querySelectorAll('button')).filter(button => {
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
            const anyButtons = Array.from(document.querySelectorAll('button')).filter(button => {
              const text = button.textContent || '';
              return text.includes('Deep Research');
            });

            if (anyButtons.length > 0) {
              console.log('Found Deep Research button by text content, clicking it');
              anyButtons[0].click();
              setTimeout(onSuccess, 500);
              return;
            }
            
            onFailure();
          }
        }, 500); // Wait for tools panel to appear
      } else {
        console.log('Could not find Tools button');
        onFailure();
      }
    } catch (error) {
      console.error(`Error enabling Deep Research: ${error}`);
      onFailure();
    }
  }

  function addTextAndSend(messageText, resolve, reject) {
    try {
      // Find the editable text area
      const editor = document.querySelector('.ql-editor');
      if (!editor) {
        reject('Editor element not found');
        return;
      }
      console.log('Found editor element');

      // Focus the editor
      try { editor.focus(); } catch {}

      // Clear existing content - use DOM methods instead of innerHTML
      try {
        while (editor.firstChild) {
          editor.removeChild(editor.firstChild);
        }
      } catch {}

      // Split text into paragraphs and add them properly
      const lines = String(messageText || '').split('\n');
      lines.forEach(line => {
        const p = document.createElement('p');
        // Use non-breaking space for empty lines to maintain structure
        p.textContent = line || '\u00A0';
        editor.appendChild(p);
      });
      console.log('Text added as individual paragraphs');

      // Dispatch input event to ensure the UI updates
      try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
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
              try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
              setTimeout(() => { // Nested timeout
                if (sendButton.getAttribute('aria-disabled') === 'true') {
                  reject('Send button is still disabled after waiting and extra event');
                  return;
                }
                try { sendButton.click(); } catch {}
                console.log('Send button clicked after extra wait');
                resolve();
              }, 500);
              return;
            }
            try { sendButton.click(); } catch {}
            console.log('Send button clicked after initial wait');
            resolve();
          }, 1000);
          return;
        }
        try { sendButton.click(); } catch {}
        console.log('Send button clicked');
        resolve();
      }, 750); // Initial wait after inserting text
    } catch (error) {
      reject(`Error adding text or sending: ${error}`);
    }
  }

  function selectModelAndProceed(messageText, resolve, reject) {
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
        addTextAndSend(messageText, resolve, reject);
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
          try { document.body.click(); } catch {}
          setTimeout(() => {
            addTextAndSend(messageText, resolve, reject);
          }, 300);
          return;
        }

        console.log('Found 2.5 Pro button, clicking it');
        proButton.click();

        // Wait for model selection to apply and dropdown to close
        setTimeout(() => {
          addTextAndSend(messageText, resolve, reject);
        }, 500);
      }, 500);
    } catch (error) {
      reject(`Error selecting model: ${error}`);
    }
  }

  function enableTemporaryChat(onSuccess, onFailure) {
    try {
      // Look for Temporary chat button in sidebar
      const tempChatButton = document.querySelector('button[aria-label="Temporary chat"]') ||
                            Array.from(document.querySelectorAll('button')).find(b => {
                              const text = b.textContent || '';
                              return text.includes('Temporary chat');
                            });
      
      if (tempChatButton) {
        console.log('Found Temporary chat button, clicking it');
        tempChatButton.click();
        setTimeout(onSuccess, 500);
      } else {
        console.log('Could not find Temporary chat button');
        onFailure();
      }
    } catch (error) {
      console.error(`Error enabling Temporary chat: ${error}`);
      onFailure();
    }
  }

  function automateGeminiChat(messageText, enableResearch, enableIncognito) {
    return new Promise((resolve, reject) => {
      try {
        // Step 1: Check if we need to enable Temporary Chat (incognito) first
        if (enableIncognito === 'Yes') {
          console.log('Incognito mode requested, will enable Temporary chat first');
          enableTemporaryChat(() => {
            console.log('Temporary chat enabled successfully');
            // Continue with research check
            handleResearchAndProceed();
          }, () => {
            console.log('Could not enable Temporary chat, continuing anyway');
            handleResearchAndProceed();
          });
        } else {
          handleResearchAndProceed();
        }
        
        function handleResearchAndProceed() {
          // Step 2: Check if we need to enable Deep Research
          if (enableResearch === 'Yes') {
            console.log('Research mode requested, will enable Deep Research');
            // Enable research before model selection to avoid dropdown conflicts
            enableDeepResearch(() => {
              // Continue with model selection after enabling research
              selectModelAndProceed(messageText, resolve, reject);
            }, () => {
              // If research enabling fails, still try to continue with model selection
              console.log('Could not enable Deep Research, continuing with model selection');
              selectModelAndProceed(messageText, resolve, reject);
            });
          } else {
            // Skip research step, go directly to model selection
            console.log('Regular mode requested, proceeding to model selection');
            selectModelAndProceed(messageText, resolve, reject);
          }
        }
      } catch (error) {
        reject(`Error in automation process: ${error}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Ported logic: geminiFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  function geminiFollowUpMessage(messageText) {
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

        try { editor.focus(); } catch {}

        // Clear existing content - use DOM methods instead of innerHTML
        try {
          while (editor.firstChild) {
            editor.removeChild(editor.firstChild);
          }
        } catch {}

        // Split text into paragraphs and add them properly
        const lines = String(messageText || '').split('\n');
        lines.forEach(line => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0'; // Use non-breaking space for empty lines
          editor.appendChild(p);
        });
        console.log('Follow-up text added as individual paragraphs');

        // Dispatch input event
        try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
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
            (sendButton.parentElement && sendButton.parentElement.classList.contains('disabled'));

          if (isDisabled) {
            console.log('Send button is disabled, waiting...');
            setTimeout(checkSendButton, 300); // Keep checking
            return;
          }
          console.log('Send button enabled, clicking');
          try { sendButton.click(); } catch {}
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

  // ---------------------------------------------------------------------------
  // Injector registration
  // ---------------------------------------------------------------------------
  ns.injectors.GEMINI = {
    submit: async ({ prompt, options }) => {
      await ensureEditorReady(15000).catch(() => {});
      const research = options && options.research ? 'Yes' : 'No';
      const incognito = options && options.incognito ? 'Yes' : 'No';
      return automateGeminiChat(String(prompt || ''), research, incognito);
    },
    followup: async ({ prompt }) => {
      await ensureEditorReady(15000).catch(() => {});
      return geminiFollowUpMessage(String(prompt || ''));
    }
  };

  try { console.debug('LLM Burst Gemini injector loaded'); } catch {}
})();