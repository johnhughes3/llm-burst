/**
 * LLM Burst - Claude Injector
 * Ported from llm_burst/sites/claude.py (SUBMIT_JS and FOLLOWUP_JS).
 *
 * Exposes:
 *   window.llmBurst.injectors.CLAUDE = {
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
      return await waitUntil(() => document.querySelector('.ProseMirror'), timeout, 100);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper functions for Research and Incognito modes
  // ---------------------------------------------------------------------------
  async function enableResearchMode(onSuccess, onFailure) {
    try {
      console.log('Attempting to enable Research mode on Claude...');

      // Wait for the Research button to appear (up to 10 seconds)
      let researchButton = null;
      const maxAttempts = 20;

      for (let i = 0; i < maxAttempts; i++) {
        // Try multiple selectors for the Research button
        researchButton = document.querySelector('button[aria-label="Research"]') ||
                        document.querySelector('.flex.shrink.min-w-8.\\!shrink-0 button') ||
                        Array.from(document.querySelectorAll('button')).find(b => {
                          const text = (b.textContent || '').trim();
                          const hasResearchText = text === 'Research' || text.includes('Research');
                          const hasResearchIcon = b.querySelector('p')?.textContent === 'Research';
                          return hasResearchText || hasResearchIcon;
                        });

        if (researchButton) {
          console.log(`Found Research button after ${i * 500}ms`);
          break;
        }

        console.log(`Waiting for Research button... attempt ${i + 1}/${maxAttempts}`);
        await wait(500);
      }

      if (researchButton) {
        console.log('Found Research button, clicking...', researchButton);
        researchButton.click();

        // Wait to verify activation
        setTimeout(() => {
          // Check if research mode is active (button might change state)
          const isActive = researchButton.getAttribute('aria-pressed') === 'true' ||
                          researchButton.classList.contains('active') ||
                          document.querySelector('[data-state="active"][aria-label="Research"]');

          if (isActive) {
            console.log('✅ Research mode successfully activated on Claude');
          } else {
            console.log('⚠️ Research button clicked, activation status unclear');
          }
          onSuccess();
        }, 500);
      } else {
        console.log('Could not find Research button after waiting');
        onFailure();
      }
    } catch (error) {
      console.error(`Error enabling Research mode: ${error}`);
      onFailure();
    }
  }

  async function enableIncognitoMode(onSuccess, onFailure) {
    try {
      console.log('Attempting to enable Incognito mode on Claude...');

      // Wait for the incognito button to appear (up to 10 seconds)
      let incognitoButton = null;
      const maxAttempts = 20;

      for (let i = 0; i < maxAttempts; i++) {
        // Try multiple selectors for the incognito button
        const headerArea = document.querySelector('.fixed.top-\\[9px\\].right-3.z-header.draggable-none');
        if (headerArea) {
          incognitoButton = headerArea.querySelector('button');
        }

        // Fallback selectors
        if (!incognitoButton) {
          incognitoButton = document.querySelector('button[aria-label*="incognito" i]') ||
                           document.querySelector('button[aria-label*="temporary" i]') ||
                           document.querySelector('button[title*="incognito" i]') ||
                           document.querySelector('button[title*="temporary" i]');
        }

        if (incognitoButton) {
          console.log(`Found Incognito button after ${i * 500}ms`);
          break;
        }

        console.log(`Waiting for Incognito button... attempt ${i + 1}/${maxAttempts}`);
        await wait(500);
      }

      if (incognitoButton) {
        console.log('Found Incognito button, clicking...', incognitoButton);
        incognitoButton.click();

        // Wait to verify activation by checking URL or UI changes
        setTimeout(() => {
          const isIncognito = window.location.href.includes('incognito') ||
                             document.querySelector('.incognito-indicator') ||
                             document.body.textContent.includes('Incognito chat') ||
                             document.body.textContent.includes('whoever you are');

          if (isIncognito) {
            console.log('✅ Incognito mode successfully activated on Claude');
          } else {
            console.log('⚠️ Incognito button clicked, activation status unclear');
          }
          onSuccess();
        }, 1000); // Longer wait for page to update
      } else {
        console.log('Could not find Incognito button after waiting');
        onFailure();
      }
    } catch (error) {
      console.error(`Error enabling Incognito mode: ${error}`);
      onFailure();
    }
  }

  // ---------------------------------------------------------------------------
  // Ported logic: automateClaudeInteraction (submit)
  // ---------------------------------------------------------------------------
  function automateClaudeInteraction(promptText, enableResearchStr, enableIncognitoStr) {
    const enableResearch = enableResearchStr === 'Yes';
    const enableIncognito = enableIncognitoStr === 'Yes';
    console.log('Starting Claude automation' +
                (enableResearch ? ' with Research enabled' : '') +
                (enableIncognito ? ' with Incognito enabled' : ''));

    return new Promise(async (resolve, reject) => {
      // Check for login page first
      try {
        if (
          document.querySelector('input[type="email"]') ||
          document.querySelector('form[action*="login"]') ||
          document.title.toLowerCase().includes('log in') ||
          document.title.toLowerCase().includes('sign up')
        ) {
          return reject('Login page detected. Please log in to Claude first.');
        }
      } catch {
        // continue
      }

      // Step 1: Enable incognito mode if requested (must be done first)
      if (enableIncognito) {
        await enableIncognitoMode(() => {
          console.log('Incognito mode enabled successfully');
        }, () => {
          console.log('Could not enable Incognito mode, continuing anyway');
        });
      }

      // Step 2: Enable research mode if requested
      let automationChain = Promise.resolve();

      if (enableResearch) {
        automationChain = automationChain.then(() => {
          return new Promise((innerResolve) => {
            enableResearchMode(() => {
              console.log('Research mode enabled successfully');
              innerResolve();
            }, () => {
              console.log('Could not enable Research mode, continuing anyway');
              innerResolve();
            });
          });
        });
      }

      // Step 2: Insert text and submit
      automationChain
        .then(() => {
          try {
            const editor = document.querySelector('.ProseMirror');
            if (!editor) {
              return reject('Claude editor element (.ProseMirror) not found');
            }

            console.log('Found editor, focusing and inserting text...');
            try { editor.focus(); } catch {}

            // Clear any existing content
            try { editor.innerHTML = ''; } catch {}

            // Insert text as paragraphs
            const lines = String(promptText || '').split('\n');
            lines.forEach((line) => {
              const p = document.createElement('p');
              p.textContent = line || '\u00A0'; // Use non-breaking space for empty lines
              editor.appendChild(p);
            });

            // Dispatch input event to update the UI
            try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
            console.log('Text inserted, looking for send button...');

            // Wait a moment for the send button to become enabled
            setTimeout(() => {
              // Find send button - try multiple selectors
              let sendButton =
                document.querySelector('button[aria-label="Send message"]') ||
                document.querySelector('button[aria-label*="Send"]') ||
                (document.querySelector('button svg.lucide-arrow-up') || null)?.closest?.('button');

              if (!sendButton) {
                return reject('Claude send button not found');
              }

              if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                console.log('Send button is disabled, waiting longer...');
                // Try again with another input event
                try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}

                setTimeout(() => {
                  if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                    return reject('Claude send button is still disabled after waiting');
                  }
                  try { sendButton.click(); } catch {}
                  console.log('Send button clicked after extra wait');
                  resolve();
                }, 800);
              } else {
                try { sendButton.click(); } catch {}
                console.log('Send button clicked');
                resolve();
              }
            }, 500);
          } catch (e) {
            reject(`Claude automation failed: ${e}`);
          }
        })
        .catch(reject);
    });
  }

  // ---------------------------------------------------------------------------
  // Ported logic: claudeFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  function claudeFollowUpMessage(promptText) {
    return new Promise((resolve, reject) => {
      try {
        const editor = document.querySelector('.ProseMirror');
        if (!editor) {
          return reject('Claude editor element (.ProseMirror) not found for follow-up');
        }

        console.log('Found editor for follow-up, focusing and inserting text...');
        try { editor.focus(); } catch {}
        try { editor.innerHTML = ''; } catch {}

        // Insert text as paragraphs
        const lines = String(promptText || '').split('\n');
        lines.forEach((line) => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0';
          editor.appendChild(p);
        });

        // Dispatch input event
        try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}

        // Scroll to bottom to ensure visibility
        try {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        } catch { /* no-op */ }

        // Wait and click send button
        setTimeout(() => {
          let sendButton =
            document.querySelector('button[aria-label="Send message"]') ||
            document.querySelector('button[aria-label*="Send"]') ||
            (document.querySelector('button svg.lucide-arrow-up') || null)?.closest?.('button');

          if (!sendButton) {
            return reject('Claude send button not found for follow-up');
          }

          if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
            try { editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
            setTimeout(() => {
              try { sendButton.click(); } catch {}
              console.log('Follow-up sent after extra wait');
              resolve();
            }, 800);
          } else {
            try { sendButton.click(); } catch {}
            console.log('Follow-up sent');
            resolve();
          }
        }, 500);
      } catch (error) {
        reject(`Error in Claude follow-up: ${error}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Injector registration
  // ---------------------------------------------------------------------------
  ns.injectors.CLAUDE = {
    submit: async ({ prompt, options }) => {
      await ensureEditorReady(15000).catch(() => {});
      const research = options && options.research ? 'Yes' : 'No';
      const incognito = options && options.incognito ? 'Yes' : 'No';
      return automateClaudeInteraction(String(prompt || ''), research, incognito);
    },
    followup: async ({ prompt }) => {
      await ensureEditorReady(15000).catch(() => {});
      return claudeFollowUpMessage(String(prompt || ''));
    }
  };

  try { console.debug('LLM Burst Claude injector loaded'); } catch {}
})();