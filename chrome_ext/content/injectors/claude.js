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
  // Ported logic: automateClaudeInteraction (submit)
  // ---------------------------------------------------------------------------
  function automateClaudeInteraction(promptText, enableResearchStr) {
    const enableResearch = enableResearchStr === 'Yes';
    console.log('Starting Claude automation' + (enableResearch ? ' with Research enabled' : ''));

    return new Promise((resolve, reject) => {
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

      // Step 1: Enable research mode if requested
      let automationChain = Promise.resolve();

      if (enableResearch) {
        automationChain = automationChain.then(() => {
          return new Promise((innerResolve) => {
            try {
              const allButtons = Array.from(document.querySelectorAll('button'));
              const researchButton = allButtons.find((b) => (b.textContent || '').includes('Research'));
              if (researchButton) {
                console.log('Found Research button, clicking...');
                researchButton.click();
                setTimeout(innerResolve, 500);
                return;
              }
              const betaTags = Array.from(document.querySelectorAll('.uppercase'));
              const parentBtn = betaTags.find((t) => (t.textContent || '').includes('beta'))?.closest?.('button');
              if (parentBtn) {
                console.log('Found Research button via beta tag, clicking...');
                parentBtn.click();
                setTimeout(innerResolve, 500);
                return;
              }
              console.log('Research button not found, continuing...');
              innerResolve();
            } catch (e) {
              console.log('Research toggle failed, continuing:', e);
              innerResolve();
            }
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
      return automateClaudeInteraction(String(prompt || ''), research);
    },
    followup: async ({ prompt }) => {
      await ensureEditorReady(15000).catch(() => {});
      return claudeFollowUpMessage(String(prompt || ''));
    }
  };

  try { console.debug('LLM Burst Claude injector loaded'); } catch {}
})();