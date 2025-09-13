/**
 * LLM Burst - ChatGPT Injector
 * Ported from llm_burst/sites/chatgpt.py (SUBMIT_JS and FOLLOWUP_JS).
 *
 * Exposes:
 *   window.llmBurst.injectors.CHATGPT = {
 *     submit: async ({ prompt, options: { research?: boolean, incognito?: boolean }}),
 *     followup: async ({ prompt })
 *   }
 *
 * Notes:
 * - Uses robust selectors for editor (#prompt-textarea, .ProseMirror).
 * - Tries to enable Deep Research via plus-menu or slash command fallback.
 * - Works even if background already navigated to Research/Incognito URLs.
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
        if (result) {
          resolve(result);
          return;
        }
        if (Date.now() - start >= timeout) {
          reject(new Error('Timeout waiting for condition'));
          return;
        }
        setTimeout(tick, interval);
      };
      tick();
    });
  });

  async function ensureEditorReady(timeout = 15000) {
    return waitUntil(
      () => document.querySelector('#prompt-textarea') || document.querySelector('.ProseMirror'),
      timeout,
      100
    ).catch(() => null);
  }

  // ---------------------------------------------------------------------------
  // Ported logic: automateOpenAIChat (submit)
  // ---------------------------------------------------------------------------
  function automateOpenAIChat(messageText, useResearch, useIncognito) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Starting ChatGPT automation. Research mode: ${useResearch}, Incognito mode: ${useIncognito}`);

        // Function to handle research mode and prompt input
        async function handleResearchAndPrompt() {
          if (useResearch === 'Yes') {
            console.log('Research mode requested. Enabling deep research mode...');
            const ok = await enableDeepResearchMode();
            if (!ok) {
              console.warn('Research mode not activated. Will NOT submit.');
              throw new Error('Research mode was requested but not activated; submission aborted');
            }
            console.log('Deep research mode enabled successfully');
            setTimeout(submitPrompt, 1200);
          } else {
            submitPrompt();
          }
        }

        // INCOGNITO MODE HANDLING
        if (useIncognito === 'Yes') {
          try {
            const buttons = document.querySelectorAll('button');
            let found = false;
            for (const button of buttons) {
              const text = (button.textContent || '');
              if (text.includes('Temporary')) {
                button.click();
                console.log('Temporary button clicked successfully');
                found = true;
                break;
              }
            }
            if (!found) {
              console.log('Incognito button not found (continuing)');
            }
          } catch {
            // ignore
          }

          setTimeout(() => {
            Promise.resolve(handleResearchAndPrompt()).catch(err => reject(err));
          }, 800);
        } else {
          Promise.resolve(handleResearchAndPrompt()).catch(err => reject(err));
        }

        // Enable research mode by selecting Pro Research model
        async function enableDeepResearchMode() {
          console.log('🚀 Attempting to enable research mode by selecting Pro model...');

          function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
          async function waitForElement(selector, timeout = 5000, maxRetries = 50) {
            const start = Date.now();
            let retries = 0;
            while (Date.now() - start < timeout && retries < maxRetries) {
              const el = document.querySelector(selector);
              if (el) return el;
              await sleep(100);
              retries++;
            }
            if (retries >= maxRetries) {
              console.log(`Max retries (${maxRetries}) reached while waiting for element: ${selector}`);
            }
            return null;
          }

          try {
            // First try: CDP trusted-click path via background debugger API
            try {
              if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                console.log('[CDP] Requesting background to enable Research via trusted clicks...');
                const resp = await chrome.runtime.sendMessage({ type: 'llmburst-chatgpt-enable-research', timeoutMs: 7000 });
                if (resp && resp.ok) {
                  console.log('[CDP] Research click sequence completed', resp);
                  const pill = await waitForElement('button.__composer-pill[aria-label*="Research" i], [aria-label*="Research" i].__composer-pill, .composer-mode-pill, [data-testid*="research"]', 4000);
                  if (pill) return true;
                  console.warn('CDP click completed, but Research pill not visible yet');
                } else {
                  console.warn('[CDP] Research click failed or unsupported:', resp?.error || 'unknown');
                }
              }
            } catch (e) {
              console.warn('[CDP] Exception calling background enable:', e);
            }

            // Try a direct Research toggle if present (role switch/button)
            try {
              const toggle = Array.from(document.querySelectorAll('[role="switch"],[aria-pressed]'))
                .find((el) => {
                  const label = (el.getAttribute('aria-label') || el.textContent || '').toLowerCase();
                  return label.includes('research');
                });
              if (toggle) {
                const state = (toggle.getAttribute('aria-checked') || toggle.getAttribute('aria-pressed') || 'false').toString();
                if (state !== 'true') {
                  console.log('Found research toggle, clicking...');
                  toggle.click();
                  const pill = await waitForElement('button.__composer-pill[aria-label*="Research" i], [aria-label*="Research" i].__composer-pill, .composer-mode-pill, [data-testid*="research"]', 3000);
                  if (pill) return true;
                }
              }
            } catch {}

            let modelButton = document.querySelector('button[aria-label*="Model selector"]') ||
                             document.querySelector('button[aria-haspopup="menu"]') ||
                             Array.from(document.querySelectorAll('button')).find(b => 
                               b.textContent && (b.textContent.includes('ChatGPT') || b.textContent.includes('GPT'))
                             );
            
            if (modelButton) {
              console.log('Found model selector button, clicking...');
              modelButton.click();
              await sleep(500);
              
              // Look for Pro Research option in the menu
              const menuItems = document.querySelectorAll('[role="menuitem"]');
              let proOption = null;
              
              for (const item of menuItems) {
                const text = (item.textContent || '').trim();
                // Look for "Pro Research-grade intelligence" or similar
                if ((text.includes('Pro') && text.toLowerCase().includes('research')) ||
                    text.toLowerCase().includes('research-grade')) {
                  proOption = item;
                  console.log(`Found Pro Research option: "${text}"`);
                  break;
                }
              }
              
              if (proOption) {
                console.log('Clicking Pro Research option...');
                proOption.click();
                const pill = await waitForElement('button.__composer-pill[aria-label*="Research" i], [aria-label*="Research" i].__composer-pill, .composer-mode-pill, [data-testid*="research"]', 3000);
                if (pill) {
                  console.log('Pro Research model selected successfully!');
                  return true;
                }
                console.warn('Model changed but Research pill not found');
              } else {
                console.log('Pro Research option not found in model menu');
                // Close the menu if it's still open
                const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 });
                document.dispatchEvent(escapeEvent);
                await sleep(300);
              }
            }
            
            // Fallback: Try to find the plus button (old approach)
            let plusButton = document.querySelector('[data-testid="composer-plus-btn"]');

            if (!plusButton) {
              const buttons = document.querySelectorAll('button');
              for (const button of buttons) {
                const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
                const hasIcon =
                  button.querySelector('svg path[d*="M12 5v14M5 12h14"]') ||
                  button.querySelector('svg path[d*="M19 12h-14M12 19v-14"]');

                if (
                  ariaLabel.includes('attach') ||
                  ariaLabel.includes('plus') ||
                  ariaLabel.includes('more') ||
                  hasIcon
                ) {
                  const inputArea = document.querySelector('#prompt-textarea, .ProseMirror');
                  if (inputArea) {
                    const inputRect = inputArea.getBoundingClientRect();
                    const buttonRect = button.getBoundingClientRect();
                    if (Math.abs(buttonRect.top - inputRect.top) < 200) {
                      plusButton = button;
                      break;
                    }
                  }
                }
              }
            }

            if (plusButton) {
              console.log('Found plus button, clicking...');
              plusButton.click();

              // Wait for menu
              await sleep(300);
              const menu = await waitForElement(
                '[role="menu"], [data-radix-portal], [role="listbox"], .popover-content, [data-state="open"]',
                3000
              );

              if (!menu) {
                console.log('Menu did not appear after clicking plus button');
                return await slashCommandFallback();
              }

              console.log('Menu appeared, looking for Deep research option...');

              let menuItems = menu.querySelectorAll(
                '[role="menuitemradio"], [role="menuitem"], [role="option"], button'
              );

              if (menuItems.length === 0) {
                menuItems = document.querySelectorAll(
                  '[role="menuitemradio"], [role="menuitem"], [role="option"]'
                );
              }

              console.log(`Found ${menuItems.length} menu items`);

              let deepResearchOption = null;
              for (const item of menuItems) {
                const text = (item.textContent || '').trim();
                if (
                  text === 'Deep research' ||
                  text.toLowerCase() === 'deep research' ||
                  (text.toLowerCase().includes('deep') && text.toLowerCase().includes('research'))
                ) {
                  deepResearchOption = item;
                  console.log(`Found Deep research option: "${text}"`);
                  break;
                }
              }

              if (deepResearchOption) {
                console.log('Clicking Deep research option...');
                deepResearchOption.click();
                const pill = await waitForElement('button.__composer-pill[aria-label*="Research" i], [aria-label*="Research" i].__composer-pill, .composer-mode-pill, [data-testid*="research"]', 3000);
                if (pill) {
                  console.log('Deep research mode successfully activated (pill visible).');
                  return true;
                }
                console.warn('Deep research item clicked but pill not visible');
              } else {
                console.log('Deep research option not found in menu');
              }
            } else {
              console.log('Plus button not found after exhaustive search');
            }

            console.log('Falling back to slash command approach...');
            return await slashCommandFallback();
          } catch (error) {
            console.log('Error enabling deep research mode:', error);
            try {
              return await slashCommandFallback();
            } catch (fallbackError) {
              console.log('Fallback also failed:', fallbackError);
              return false;
            }
          }
        }

        // Slash command fallback for deep research
        async function slashCommandFallback() {
          try {
            console.log('Using slash command approach...');

            function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
            async function waitForElement(selector, timeout = 5000, maxRetries = 50) {
              const start = Date.now();
              let retries = 0;
              while (Date.now() - start < timeout && retries < maxRetries) {
                const el = document.querySelector(selector);
                if (el) return el;
                await sleep(100);
                retries++;
              }
              if (retries >= maxRetries) {
                console.log(`Max retries (${maxRetries}) reached while waiting for element: ${selector}`);
              }
              return null;
            }

            const textArea = document.querySelector(
              '#prompt-textarea, [data-testid="prompt-textarea"], .ProseMirror, [role="paragraph"]'
            );

            if (!textArea) {
              console.log('Text area not found for slash command');
              return false;
            }

            console.log('Found text area, focusing and typing slash...');
            try { textArea.click(); textArea.focus(); } catch {}
            await sleep(200);

            // Clear existing content
            try { textArea.innerHTML = ''; } catch {}

            // Dispatch beforeinput/input/keydown to trigger command menu
            try {
              const beforeInputEvent = new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: '/',
                bubbles: true,
                cancelable: true
              });
              textArea.dispatchEvent(beforeInputEvent);
            } catch {}

            try { textArea.textContent = '/'; } catch {}

            try {
              const inputEvent = new InputEvent('input', {
                inputType: 'insertText',
                data: '/',
                bubbles: true
              });
              textArea.dispatchEvent(inputEvent);
            } catch {}

            try {
              const keydownEvent = new KeyboardEvent('keydown', {
                key: '/',
                code: 'Slash',
                keyCode: 191,
                bubbles: true,
                cancelable: true
              });
              textArea.dispatchEvent(keydownEvent);
            } catch {}

            // Wait for the command menu
            const commandMenu = await waitForElement(
              '[role="listbox"], [role="menu"], [data-radix-portal], .command-menu, [data-testid*="command-menu"]',
              3000
            );

            if (!commandMenu) {
              console.log('Command menu did not appear after typing slash');
              try {
                textArea.innerHTML = '';
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
              } catch {}
              return false;
            }

            console.log('Command menu appeared, looking for Deep research option...');

            const menuItems = commandMenu.querySelectorAll(
              '[role="option"], [role="menuitem"], [data-testid*="menu-item"], div[class*="item"], button'
            );

            let deepResearchOption = null;
            for (const item of menuItems) {
              const text = (item.textContent || '').trim().toLowerCase();
              if (text.includes('deep research') || text === 'deep research') {
                deepResearchOption = item;
                console.log(`Found Deep research option: "${text}"`);
                break;
              }
            }

            if (deepResearchOption) {
              console.log('Clicking Deep research option...');
              deepResearchOption.click();
              const pill = await waitForElement('button.__composer-pill[aria-label*="Research" i], [aria-label*="Research" i].__composer-pill, .composer-mode-pill, [data-testid*="research"]', 3000);
              if (pill) {
                console.log('Deep research enabled via slash command!');
                return true;
              }
              console.warn('Slash: clicked item but pill not visible');
              return false;
            } else {
              console.log('Deep research option not found in command menu');
              try {
                textArea.innerHTML = '';
                textArea.dispatchEvent(new Event('input', { bubbles: true }));
              } catch {}
              return false;
            }
          } catch (error) {
            console.log('Slash command approach failed:', error);
            return false;
          }
        }

        // Function to submit the prompt
        function submitPrompt() {
          ensureEditorReady(15000)
            .then(() => {
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

              // Focus the editor and clear content
              try { editorElement.focus(); } catch {}
              try { editorElement.innerHTML = ''; } catch {}

              // Create a paragraph element with the text
              try {
                const paragraph = document.createElement('p');
                paragraph.textContent = messageText;
                editorElement.appendChild(paragraph);
              } catch {}

              // Dispatch multiple events to ensure the UI registers the change
              try {
                const inputEvent = new Event('input', { bubbles: true, cancelable: true });
                const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                const keyupEvent = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ' });

                editorElement.dispatchEvent(inputEvent);
                editorElement.dispatchEvent(changeEvent);
                editorElement.dispatchEvent(keyupEvent);
              } catch {}

              // Optional native setter path for textareas (if any)
              try {
                const descTA = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                const descIN = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                const setter = (descTA && descTA.set) || (descIN && descIN.set);
                if (setter && editorElement.value !== undefined) {
                  setter.call(editorElement, messageText);
                  editorElement.dispatchEvent(new Event('input', { bubbles: true }));
                }
              } catch {}

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
                try { sendButton.click(); } catch {}
                console.log('Send button clicked');
                resolve();
              };

              // Start checking after initial delay
              setTimeout(checkForSendButton, 1000); // Give time for the button to appear after text is entered
            })
            .catch((e) => {
              reject(e?.message || String(e));
            });
        }
      } catch (error) {
        reject(`Error: ${error}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Ported logic: chatGPTFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  function chatGPTFollowUpMessage(messageText) {
    return new Promise((resolve, reject) => {
      try {
        // Find the editor element
        const editorElement =
          document.querySelector('#prompt-textarea') ||
          document.querySelector('.ProseMirror');

        if (!editorElement) {
          console.error('Editor element not found');
          reject('Editor element not found');
          return;
        }

        console.log('Found ChatGPT editor element');

        // Focus the editor and clear content
        try { editorElement.focus(); } catch {}
        try { editorElement.innerHTML = ''; } catch {}

        // Set the text content
        try { editorElement.textContent = messageText; } catch {}

        // Dispatch input event to ensure ChatGPT registers the change
        try {
          const inputEvent = new Event('input', { bubbles: true });
          editorElement.dispatchEvent(inputEvent);
        } catch {}

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
          try { sendButton.click(); } catch {}
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

  // ---------------------------------------------------------------------------
  // Injector registration
  // ---------------------------------------------------------------------------
  ns.injectors.CHATGPT = {
    submit: async ({ prompt, options }) => {
      await ensureEditorReady(15000).catch(() => {});
      const research = options && options.research ? 'Yes' : 'No';
      const incognito = options && options.incognito ? 'Yes' : 'No';
      return automateOpenAIChat(String(prompt || ''), research, incognito);
    },
    followup: async ({ prompt }) => {
      await ensureEditorReady(15000).catch(() => {});
      return chatGPTFollowUpMessage(String(prompt || ''));
    }
  };

  try { console.debug('LLM Burst ChatGPT injector loaded'); } catch {}
})();
