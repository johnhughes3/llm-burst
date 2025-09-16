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
(function () {
  'use strict';

  const ns = /** @type {Record<string, any>} */ (window.llmBurst = window.llmBurst || {});
  ns.injectors = ns.injectors || {};
  const u = /** @type {Record<string, any>} */ (ns.utils || {});

  const wait = u.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0)));
  const waitUntil =
    u.waitUntil ||
    ((condition, timeout = 5000, interval = 100) => {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          let result = null;
          try {
            result = condition();
          } catch {
            /* ignore */
          }
          if (result) return resolve(result);
          if (Date.now() - start >= timeout)
            return reject(new Error('Timeout waiting for condition'));
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
  async function enableResearchMode() {
    try {
      console.log('Attempting to enable Research mode on Claude...');

      // Wait for the Research button to appear (up to 15 seconds - longer for multi-tab scenarios)
      /** @type {HTMLButtonElement | null} */
      let researchButton = null;
      const maxAttempts = 30;

      for (let i = 0; i < maxAttempts; i++) {
        // Try multiple selectors for the Research button
        researchButton =
          /** @type {HTMLButtonElement | null} */ (
            document.querySelector('button[aria-label="Research"]')
          ) ||
          /** @type {HTMLButtonElement | null} */ (
            document.querySelector('.flex.shrink.min-w-8.\\!shrink-0 button')
          ) ||
          /** @type {HTMLButtonElement | null} */ (
            Array.from(document.querySelectorAll('button')).find((b) => {
              const text = (b.textContent || '').trim();
              const hasResearchText = text === 'Research' || text.includes('Research');
              const hasResearchIcon = b.querySelector('p')?.textContent === 'Research';
              return hasResearchText || hasResearchIcon;
            }) || null
          );

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
        await wait(700);

        // Check if research mode is active (button might change state)
        const isActive =
          researchButton.getAttribute('aria-pressed') === 'true' ||
          researchButton.classList.contains('active') ||
          document.querySelector('[data-state="active"][aria-label="Research"]');

        if (isActive) {
          console.log('✅ Research mode successfully activated on Claude');
          return true;
        } else {
          console.log('⚠️ Research button clicked, activation status unclear');
          return true; // Still return true since we clicked it
        }
      } else {
        console.log('Could not find Research button after waiting 15 seconds');
        return false;
      }
    } catch (error) {
      console.error(`Error enabling Research mode: ${error}`);
      return false;
    }
  }

  const INCOGNITO_ICON_SIGNATURES = ['look-around', '6.99951 8.66672', '10 2C 14.326'];

  function isIncognitoActive() {
    try {
      if (typeof window !== 'undefined') {
        const href = String(window.location.href || '');
        if (href.includes('/incognito') || href.includes('?incognito')) {
          return true;
        }
      }

      const indicatorSelectors = [
        '[data-testid="incognito-mode-indicator"]',
        '[aria-label*="incognito" i][data-state="active"]',
      ];
      if (indicatorSelectors.some((sel) => document.querySelector(sel))) {
        return true;
      }

      const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
      return bodyText.includes("you're incognito") || bodyText.includes('incognito chat');
    } catch {
      return false;
    }
  }

  function isLikelyIncognitoButton(button) {
    if (!button) return false;

    const aria = (button.getAttribute('aria-label') || '').toLowerCase();
    const title = (button.getAttribute('title') || '').toLowerCase();
    if (aria.includes('more options') || title.includes('more options')) return false;
    const hasSemanticLabel =
      aria.includes('incognito') ||
      aria.includes('anonymous') ||
      aria.includes('temporary') ||
      title.includes('incognito') ||
      title.includes('anonymous') ||
      title.includes('temporary');

    const html = button.innerHTML || '';
    const hasSignature = INCOGNITO_ICON_SIGNATURES.some((sig) => html.includes(sig));

    const rect = button.getBoundingClientRect?.() || {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    if (rect.y > (window.innerHeight || 0) * 0.5) return false;
    if (rect.width < 8 || rect.height < 8) return false;
    if (rect.x < (window.innerWidth || 0) * 0.5) return false;

    // Avoid obvious menu/settings buttons by checking aria attributes again
    if (
      aria.includes('settings') ||
      aria.includes('menu') ||
      title.includes('settings') ||
      title.includes('menu')
    ) {
      return false;
    }

    return hasSemanticLabel || hasSignature;
  }

  /**
   * @returns {HTMLButtonElement | null}
   */
  function findIncognitoButton() {
    const headerCandidates = Array.from(
      document.querySelectorAll('[class*="top"][class*="right"], header, [data-testid="top-bar"]'),
    ).flatMap((container) => Array.from(container.querySelectorAll('button')));

    const allButtons = new Set(
      headerCandidates.concat(Array.from(document.querySelectorAll('button'))),
    );
    for (const btn of allButtons) {
      if (isLikelyIncognitoButton(btn)) {
        return /** @type {HTMLButtonElement} */ (btn);
      }
    }
    return null;
  }

  /**
   * @param {number} [timeout]
   * @param {number} [interval]
   * @returns {Promise<HTMLButtonElement | null>}
   */
  async function waitForIncognitoButton(timeout = 15000, interval = 150) {
    return waitUntil(
      () => {
        const btn = findIncognitoButton();
        return btn || false;
      },
      timeout,
      interval,
    ).catch(() => null);
  }

  /**
   * @param {HTMLElement} element
   */
  async function ensureElementInteractable(element) {
    try {
      element.scrollIntoView({
        block: 'center',
        inline: 'center',
        behavior: 'instant',
      });
    } catch {
      /* no-op */
    }

    if (typeof element.focus === 'function') {
      try {
        element.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }

    await wait(50);
  }

  /**
   * @param {HTMLElement} button
   */
  async function clickButtonReliably(button) {
    const events = ['pointerdown', 'pointerup', 'click'];
    for (const type of events) {
      try {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        button.dispatchEvent(event);
      } catch {
        /* ignore */
      }
      await wait(10);
    }
  }

  /**
   * @param {number} [timeout]
   */
  async function verifyIncognitoEnabled(timeout = 6000) {
    try {
      await waitUntil(() => isIncognitoActive(), timeout, 200);
      return true;
    } catch {
      return false;
    }
  }

  async function enableIncognitoMode({ maxAttempts = 3, buttonTimeout = 15000 } = {}) {
    try {
      if (isIncognitoActive()) {
        console.log('✅ Incognito mode already active');
        return true;
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`Attempt ${attempt}/${maxAttempts} to enable Incognito mode...`);

        const button = /** @type {HTMLButtonElement | null} */ (
          await waitForIncognitoButton(buttonTimeout)
        );
        if (!button) {
          console.log('Incognito button not found within timeout');
          continue;
        }

        await ensureElementInteractable(button);

        await clickButtonReliably(button);

        const activated = await verifyIncognitoEnabled(7000);
        if (activated) {
          console.log('✅ Incognito mode successfully activated on Claude');
          await wait(400); // allow UI to settle
          return true;
        }

        console.log('Incognito verification failed after click, retrying after short delay...');
        await wait(1200);
      }

      console.warn('Unable to confirm Incognito activation after retries');
      return false;
    } catch (error) {
      console.error(`Error enabling Incognito mode: ${error}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Ported logic: automateClaudeInteraction (submit)
  // ---------------------------------------------------------------------------
  async function automateClaudeInteraction(promptText, enableResearchStr, enableIncognitoStr) {
    const enableResearch = enableResearchStr === 'Yes';
    const enableIncognito = enableIncognitoStr === 'Yes';
    console.log(
      'Starting Claude automation' +
        (enableResearch ? ' with Research enabled' : '') +
        (enableIncognito ? ' with Incognito enabled' : ''),
    );

    // Check for login page first
    try {
      if (
        document.querySelector('input[type="email"]') ||
        document.querySelector('form[action*="login"]') ||
        document.title.toLowerCase().includes('log in') ||
        document.title.toLowerCase().includes('sign up')
      ) {
        throw new Error('Login page detected. Please log in to Claude first.');
      }
    } catch (e) {
      if (e.message && e.message.includes('Login page')) {
        throw e;
      }
      // continue if it's a different error
    }

    // Step 1: Enable incognito mode if requested (must be done first)
    if (enableIncognito) {
      const incognitoSuccess = await enableIncognitoMode();
      if (incognitoSuccess) {
        console.log('Incognito mode enabled successfully');
        // Extra wait after incognito to ensure page is fully ready
        await wait(1000);
      } else {
        console.log('Could not enable Incognito mode, continuing anyway');
      }
    }

    // Step 2: Enable research mode if requested
    if (enableResearch) {
      const researchSuccess = await enableResearchMode();
      if (researchSuccess) {
        console.log('Research mode enabled successfully');
      } else {
        console.log('Could not enable Research mode, continuing anyway');
      }
    }

    // Step 3: Insert text and submit
    return new Promise((resolve, reject) => {
      try {
        const editor = /** @type {HTMLElement | null} */ (document.querySelector('.ProseMirror'));
        if (!editor) {
          return reject('Claude editor element (.ProseMirror) not found');
        }

        console.log('Found editor, focusing and inserting text...');
        try {
          editor.focus();
        } catch {}

        // Clear any existing content
        try {
          editor.innerHTML = '';
        } catch {}

        // Insert text as paragraphs
        const lines = String(promptText || '').split('\n');
        lines.forEach((line) => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0'; // Use non-breaking space for empty lines
          editor.appendChild(p);
        });

        // Dispatch input event to update the UI
        try {
          editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch {}
        console.log('Text inserted, looking for send button...');

        // Wait a moment for the send button to become enabled
        setTimeout(() => {
          // Find send button - try multiple selectors
          let sendButton =
            /** @type {HTMLButtonElement | null} */ (
              document.querySelector('button[aria-label="Send message"]')
            ) ||
            /** @type {HTMLButtonElement | null} */ (
              document.querySelector('button[aria-label*="Send"]')
            ) ||
            /** @type {HTMLButtonElement | null} */ (
              (document.querySelector('button svg.lucide-arrow-up') || null)?.closest?.('button') ||
                null
            );

          if (!sendButton) {
            return reject('Claude send button not found');
          }

          if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
            console.log('Send button is disabled, waiting longer...');
            // Try again with another input event
            try {
              editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            } catch {}

            setTimeout(() => {
              if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
                return reject('Claude send button is still disabled after waiting');
              }
              try {
                sendButton.click();
              } catch {}
              console.log('Send button clicked after extra wait');
              resolve();
            }, 800);
          } else {
            try {
              sendButton.click();
            } catch {}
            console.log('Send button clicked');
            resolve();
          }
        }, 500);
      } catch (e) {
        reject(`Claude automation failed: ${e}`);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Ported logic: claudeFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  function claudeFollowUpMessage(promptText) {
    return new Promise((resolve, reject) => {
      try {
        const editor = /** @type {HTMLElement | null} */ (document.querySelector('.ProseMirror'));
        if (!editor) {
          return reject('Claude editor element (.ProseMirror) not found for follow-up');
        }

        console.log('Found editor for follow-up, focusing and inserting text...');
        try {
          editor.focus();
        } catch {}
        try {
          editor.innerHTML = '';
        } catch {}

        // Insert text as paragraphs
        const lines = String(promptText || '').split('\n');
        lines.forEach((line) => {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0';
          editor.appendChild(p);
        });

        // Dispatch input event
        try {
          editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch {}

        // Scroll to bottom to ensure visibility
        try {
          window.scrollTo({
            top: document.documentElement.scrollHeight,
            behavior: 'smooth',
          });
        } catch {
          /* no-op */
        }

        // Wait and click send button
        setTimeout(() => {
          let sendButton =
            /** @type {HTMLButtonElement | null} */ (
              document.querySelector('button[aria-label="Send message"]')
            ) ||
            /** @type {HTMLButtonElement | null} */ (
              document.querySelector('button[aria-label*="Send"]')
            ) ||
            /** @type {HTMLButtonElement | null} */ (
              (document.querySelector('button svg.lucide-arrow-up') || null)?.closest?.('button') ||
                null
            );

          if (!sendButton) {
            return reject('Claude send button not found for follow-up');
          }

          if (sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
            try {
              editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            } catch {}
            setTimeout(() => {
              try {
                sendButton.click();
              } catch {}
              console.log('Follow-up sent after extra wait');
              resolve();
            }, 800);
          } else {
            try {
              sendButton.click();
            } catch {}
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
    },
  };

  try {
    console.debug('LLM Burst Claude injector loaded');
  } catch {}
})();
