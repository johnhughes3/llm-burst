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
  async function enableCanvas() {
    try {
      console.log('Attempting to enable Canvas mode on Gemini...');

      // Wait for the Tools button to appear (up to 10 seconds)
      let toolsButton = null;
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        toolsButton = document.querySelector('button.toolbox-drawer-button') ||
                     document.querySelector('[aria-label*="Tools"]') ||
                     document.querySelector('[aria-label*="toolbox"]') ||
                     document.querySelector('[aria-label*="Toolbox"]') ||
                     document.querySelector('button[jsname*="tool"]') ||
                     document.querySelector('button.mdc-button.mat-mdc-button-base.toolbox-drawer-button') ||
                     Array.from(document.querySelectorAll('button')).find(b => {
                       const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                       const text = (b.textContent || '').toLowerCase();
                       return ariaLabel.includes('tool') || text.includes('tools');
                     });

        if (toolsButton) {
          console.log(`Found Tools button after ${i * 500}ms`);
          break;
        }

        console.log(`Waiting for Tools button... attempt ${i + 1}/${maxAttempts}`);
        await wait(500);
      }

      if (!toolsButton) {
        console.log('Could not find Tools button');
        return false;
      }

      console.log('Found toolbox/Tools button, clicking...', toolsButton);
      toolsButton.click();

      // Wait for drawer to open
      await wait(800);
      console.log('Looking for Canvas button in drawer...');

      // Look for Canvas button
      const canvasButton = document.querySelector('button[aria-label*="Canvas"]') ||
                          Array.from(document.querySelectorAll('button')).find(b => {
                            const text = (b.textContent || '').trim();
                            const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                            return text === 'Canvas' || ariaLabel.includes('canvas');
                          });

      if (!canvasButton) {
        console.log('Canvas button not found in drawer');
        return false;
      }

      console.log('Found Canvas button, clicking...', canvasButton);
      canvasButton.click();

      // Wait and verify activation
      await wait(700);

      const canvasPill = document.querySelector('button[aria-label*="Deselect Canvas"]') ||
                        document.querySelector('[aria-label*="Canvas"].selected') ||
                        document.querySelector('.toolbox-chip[aria-label*="Canvas"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => {
                          const text = b.textContent || '';
                          const ariaLabel = b.getAttribute('aria-label') || '';
                          return (text.includes('Canvas') && b.querySelector('img[src*="close"]')) ||
                                 ariaLabel.includes('Deselect Canvas');
                        });

      if (canvasPill) {
        console.log('✅ Canvas mode successfully activated on Gemini');
        return true;
      } else {
        console.log('⚠️ Canvas clicked but activation not confirmed');
        return true; // Still return true as the click happened
      }
    } catch (error) {
      console.error(`Error enabling Canvas: ${error}`);
      return false;
    }
  }

  async function enableDeepResearch() {
    try {
      console.log('Attempting to enable Deep Research mode on Gemini...');

      // Wait for the Tools button to appear (up to 10 seconds)
      let firstButton = null;
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        firstButton = document.querySelector('button.toolbox-drawer-button') ||
                     document.querySelector('[aria-label*="Tools"]') ||
                     document.querySelector('[aria-label*="toolbox"]') ||
                     document.querySelector('[aria-label*="Toolbox"]') ||
                     document.querySelector('button[jsname*="tool"]') ||
                     document.querySelector('button.mdc-button.mat-mdc-button-base.toolbox-drawer-button') ||
                     Array.from(document.querySelectorAll('button')).find(b => {
                       const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                       const text = (b.textContent || '').toLowerCase();
                       return ariaLabel.includes('tool') || text.includes('tools');
                     });

        if (firstButton) {
          console.log(`Found Tools button after ${i * 500}ms`);
          break;
        }

        console.log(`Waiting for Tools button... attempt ${i + 1}/${maxAttempts}`);
        await wait(500);
      }

      if (!firstButton) {
        console.log('Could not find Tools button');
        return false;
      }

      console.log('Found toolbox/Tools button, clicking...', firstButton);
      firstButton.click();

      // Wait for drawer to open
      await wait(800);
      console.log('Looking for Deep Research button in drawer...');

      // Debug: Log all buttons to help identify the right one
      const allButtons = Array.from(document.querySelectorAll('button'));
      console.log('All buttons in drawer:', allButtons.map(b => ({
        text: b.textContent?.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        classes: b.className
      })));

      // Look for Deep Research button with expanded selectors
      const secondButton = document.querySelector('button[aria-label*="Deep research"]') ||
                          document.querySelector('button[aria-label*="Deep Research"]') ||
                          document.querySelector('button[aria-label*="deep research" i]') ||
                          document.querySelector('[data-tool-name="deep_research"]') ||
                          document.querySelector('button.toolbox-drawer-item-list-button') ||
                          Array.from(document.querySelectorAll('button')).find(b => {
                            const text = (b.textContent || '').toLowerCase();
                            const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                            return text.includes('deep research') ||
                                   text.includes('deep-research') ||
                                   ariaLabel.includes('deep research') ||
                                   ariaLabel.includes('deep-research');
                          });

      if (!secondButton) {
        console.log('Deep Research button not found in drawer');

        // Fallback: Try any button with Deep Research text
        const anyButtons = Array.from(document.querySelectorAll('button')).filter(button => {
          const text = (button.textContent || '').toLowerCase();
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('deep research') || ariaLabel.includes('deep research');
        });

        if (anyButtons.length > 0) {
          console.log('Found Deep Research button by fallback search, clicking it', anyButtons[0]);
          anyButtons[0].click();
          await wait(700);
          return true;
        }

        console.log('Could not find Deep Research button with any selector');
        return false;
      }

      console.log('Found Deep Research button, clicking...', secondButton);
      secondButton.click();

      // Wait and verify activation
      await wait(700);
      
      const deepResearchPill = document.querySelector('button[aria-label*="Deselect Deep Research"]') ||
                              document.querySelector('[aria-label*="Deep Research"].selected') ||
                              document.querySelector('.toolbox-chip[aria-label*="Deep Research"]') ||
                              Array.from(document.querySelectorAll('button')).find(b => {
                                const text = b.textContent || '';
                                const ariaLabel = b.getAttribute('aria-label') || '';
                                return (text.includes('Deep Research') && b.querySelector('img[src*="close"]')) ||
                                       ariaLabel.includes('Deselect Deep Research');
                              });

      if (deepResearchPill) {
        console.log('✅ Deep Research mode successfully activated on Gemini');
        return true;
      } else {
        console.log('⚠️ Deep Research clicked but activation not confirmed');
        return true; // Still return true as the click happened
      }
    } catch (error) {
      console.error(`Error enabling Deep Research: ${error}`);
      return false;
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

  function selectModelAndPasteOnly(messageText, resolve, reject) {
    try {
      // Find and click the model selector button
      console.log('Looking for model selector button (paste-only mode)');

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
        // Skip to pasting text only
        addTextOnly(messageText, resolve, reject);
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
            addTextOnly(messageText, resolve, reject);
          }, 300);
          return;
        }

        console.log('Found 2.5 Pro button, clicking it');
        proButton.click();

        // Wait for model selection to apply and dropdown to close
        setTimeout(() => {
          addTextOnly(messageText, resolve, reject);
        }, 500);
      }, 500);
    } catch (error) {
      reject(`Error selecting model: ${error}`);
    }
  }

  function addTextOnly(messageText, resolve, reject) {
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

      console.log('⚠️ Text pasted but NOT submitted - Deep Research activation failed');
      console.log('Please manually enable Deep Research and click send.');

      // Resolve successfully since we pasted the text
      resolve({ pastedOnly: true, reason: 'Deep Research activation failed' });
    } catch (error) {
      reject(`Error adding text: ${error}`);
    }
  }

  async function enableTemporaryChat() {
    try {
      console.log('Attempting to enable Temporary/Incognito chat mode on Gemini...');

      // Step 1: First click the main menu button
      console.log('Looking for main menu button...');
      let mainMenuButton = null;
      const maxMenuAttempts = 10;

      for (let i = 0; i < maxMenuAttempts; i++) {
        mainMenuButton = document.querySelector('button.main-menu-button') ||
                        document.querySelector('button.mdc-icon-button.mat-mdc-icon-button.mat-mdc-button-base.mat-mdc-tooltip-trigger.main-menu-button') ||
                        document.querySelector('[class*="main-menu-button"]') ||
                        Array.from(document.querySelectorAll('button')).find(b => {
                          const classList = b.className || '';
                          return classList.includes('main-menu-button');
                        });

        if (mainMenuButton) {
          console.log(`Found main menu button after ${i * 200}ms`);
          break;
        }

        console.log(`Waiting for main menu button... attempt ${i + 1}/${maxMenuAttempts}`);
        await wait(200);
      }

      if (!mainMenuButton) {
        console.log('Could not find main menu button');
        return false;
      }

      console.log('Clicking main menu button...', mainMenuButton);
      mainMenuButton.click();

      // Wait for menu to open
      await wait(500);

      // Step 2: Now wait for and click the Temporary chat button
      console.log('Looking for Temporary chat button in menu...');
      let tempChatButton = null;
      const maxTempAttempts = 10;

      for (let i = 0; i < maxTempAttempts; i++) {
        // Try multiple selectors for the temp chat button
        tempChatButton = document.querySelector('button.temp-chat-button') ||
                        document.querySelector('button.mdc-icon-button.mat-mdc-icon-button.mat-mdc-button-base.mat-mdc-tooltip-trigger.temp-chat-button') ||
                        document.querySelector('[class*="temp-chat-button"]') ||
                        document.querySelector('button[aria-label="Temporary chat"]') ||
                        document.querySelector('button[aria-label*="Temporary"]') ||
                        document.querySelector('[aria-label*="temporary" i]') ||
                        Array.from(document.querySelectorAll('button')).find(b => {
                          const text = (b.textContent || '').toLowerCase();
                          const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase();
                          const classList = b.className || '';
                          return text.includes('temporary') ||
                                 ariaLabel.includes('temporary') ||
                                 classList.includes('temp-chat');
                        });

        if (tempChatButton) {
          console.log(`Found Temporary chat button after ${i * 200}ms`);
          break;
        }

        console.log(`Waiting for Temporary chat button... attempt ${i + 1}/${maxTempAttempts}`);
        await wait(200);
      }

      if (!tempChatButton) {
        console.log('Could not find Temporary chat button in menu');
        
        // Try to close the menu by clicking elsewhere
        try { document.body.click(); } catch {}
        
        return false;
      }

      console.log('Found Temporary chat button, clicking it', tempChatButton);
      tempChatButton.click();

      // Wait a bit to verify it was activated
      await wait(1000);
      
      // Check if temporary chat is active (button might change appearance or a new indicator appears)
      const isActive = document.querySelector('.temp-chat-active') ||
                      document.querySelector('[aria-pressed="true"].temp-chat-button') ||
                      window.location.href.includes('temp') ||
                      Array.from(document.querySelectorAll('*')).find(el => {
                        const text = (el.textContent || '').toLowerCase();
                        return text.includes('temporary chat is on') || 
                               text.includes('incognito mode') ||
                               text.includes('temporary conversation');
                      });

      if (isActive) {
        console.log('✅ Temporary/Incognito chat successfully activated on Gemini');
        return true;
      } else {
        console.log('⚠️ Temporary chat button clicked, waiting longer to verify...');
        
        // Give it more time and check again
        await wait(1500);
        
        const isActiveRetry = window.location.href.includes('temp') ||
                             document.body.textContent.toLowerCase().includes('temporary');
        
        if (isActiveRetry) {
          console.log('✅ Temporary/Incognito chat activated after additional wait');
          return true;
        } else {
          console.log('⚠️ Temporary chat activation status still unclear, proceeding anyway');
          return true; // Return true since we clicked it
        }
      }
    } catch (error) {
      console.error(`Error enabling Temporary chat: ${error}`);
      return false;
    }
  }

  async function waitForAndClickResearchConfirm() {
    try {
      console.log('Starting to wait for Deep Research confirm button...');
      const maxAttempts = 120; // 60 seconds (120 * 500ms)

      for (let i = 0; i < maxAttempts; i++) {
        // Look for the confirm button with multiple selectors
        const confirmButton = document.querySelector('button.confirm-button') ||
                             document.querySelector('button.mdc-button.mat-mdc-button-base.confirm-button') ||
                             document.querySelector('button.mdc-button.mat-mdc-button-base.confirm-button.mdc-button--unelevated.mat-mdc-unelevated-button.mat-primary.ng-star-inserted') ||
                             Array.from(document.querySelectorAll('button')).find(b => {
                               const text = (b.textContent || '').toLowerCase();
                               const classes = b.className || '';
                               return (text.includes('confirm') || text.includes('continue') || text.includes('proceed')) &&
                                      classes.includes('confirm-button');
                             });

        if (confirmButton && !confirmButton.disabled) {
          console.log(`Found Deep Research confirm button after ${(i * 500) / 1000} seconds, clicking...`);
          confirmButton.click();
          console.log('✅ Deep Research plan confirmed successfully');
          return true;
        }

        // Log progress every 5 seconds
        if (i > 0 && i % 10 === 0) {
          console.log(`Still waiting for Deep Research confirm button... ${(i * 500) / 1000}s elapsed`);
        }

        await wait(500);
      }

      console.log('Deep Research confirm button did not appear within 60 seconds');
      return false;
    } catch (error) {
      console.log('Error while waiting for Deep Research confirm button:', error);
      return false;
    }
  }

  async function automateGeminiChat(messageText, enableResearch, enableIncognito) {
    try {
      // Track if we're in research mode for the follow-up action
      let isResearchMode = false;

      // Step 1: Check if we need to enable Temporary Chat (incognito) first
      if (enableIncognito === 'Yes') {
        console.log('Incognito mode requested, will enable Temporary chat first');
        const tempChatSuccess = await enableTemporaryChat();
        if (tempChatSuccess) {
          console.log('Temporary chat enabled successfully');
        } else {
          console.log('Could not enable Temporary chat, continuing anyway');
        }
      }

      // Step 2: Check if we need to enable Deep Research or Canvas
      if (enableResearch === 'Yes') {
        console.log('Research mode requested, will enable Deep Research');
        isResearchMode = true;
        // Enable research before model selection to avoid dropdown conflicts
        const researchSuccess = await enableDeepResearch();

        if (researchSuccess) {
          // Successfully enabled Deep Research, continue with model selection and submission
          return new Promise((resolve, reject) => {
            selectModelAndProceed(messageText, resolve, reject);

            // After successful submission in research mode, start waiting for confirm button
            // This is non-blocking - we don't await it
            waitForAndClickResearchConfirm().catch(err => {
              console.log('Non-critical error in research confirm:', err);
            });
          });
        } else {
          // Failed to enable Deep Research - paste text but DON'T submit
          console.log('⚠️ Could not enable Deep Research mode. Pasting prompt without submitting.');
          return new Promise((resolve, reject) => {
            selectModelAndPasteOnly(messageText, resolve, reject);
          });
        }
      } else {
        // Deep Research not selected - enable Canvas instead
        // Canvas and Deep Research are mutually exclusive, but Canvas is compatible with incognito
        console.log('Regular mode requested, will enable Canvas');
        const canvasSuccess = await enableCanvas();
        if (canvasSuccess) {
          console.log('Canvas enabled successfully');
        } else {
          console.log('Could not enable Canvas, continuing anyway');
        }

        // Proceed to model selection and submission
        return new Promise((resolve, reject) => {
          selectModelAndProceed(messageText, resolve, reject);
        });
      }
    } catch (error) {
      throw new Error(`Error in automation process: ${error}`);
    }
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