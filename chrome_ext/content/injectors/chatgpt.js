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
  // DOM Helper Functions for robust UI interaction
  // ---------------------------------------------------------------------------
  function now() { return performance ? performance.now() : Date.now(); }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function jitter(ms) {
    // decorrelated jitter: random between 50%–150% of ms
    const f = 0.5 + Math.random();
    return Math.max(25, Math.floor(ms * f));
  }

  function normalizeText(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const cs = window.getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    // inert containers are non-interactive
    let n = el;
    while (n) {
      if (n.hasAttribute && (n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true')) return false;
      n = n.parentNode;
    }
    return true;
  }

  async function waitForVisible(selector, { timeoutMs = 6000, signal } = {}) {
    const start = now();
    while (now() - start < timeoutMs) {
      if (signal?.aborted) throw new Error('aborted');
      const el = document.querySelector(selector);
      if (el && isVisible(el)) return el;
      await sleep(50);
    }
    return null;
  }

  // Wait until no subtree mutations for stableForMs (e.g., Radix menu finishing layout)
  async function waitForStableSubtree(root, { stableForMs = 180, timeoutMs = 4000, signal } = {}) {
    if (!root) return false;
    let lastTs = now();
    let resolved = false;

    return new Promise((resolve) => {
      const done = (ok) => { if (!resolved) { resolved = true; obs.disconnect(); resolve(!!ok); } };
      const obs = new MutationObserver(() => { lastTs = now(); });
      try { obs.observe(root, { childList: true, subtree: true, attributes: true }); } catch { done(false); return; }

      const tick = async () => {
        if (signal?.aborted) return done(false);
        const elapsed = now() - lastTs;
        if (elapsed >= stableForMs) return done(true);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      setTimeout(() => done(false), timeoutMs);
    });
  }

  async function clickInteractable(el) {
    if (!el) throw new Error('no element to click');
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    await sleep(16); // 1 frame for scroll
    const rect = el.getBoundingClientRect();
    if (!isVisible(el)) throw new Error('element not visible');
    // Dispatch pointer + mouse sequence to match browser semantics
    const opts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
    try { el.click(); } catch {}
  }

  async function withRetries(fn, { tries = 3, baseMs = 120, deadlineMs = 12000 } = {}) {
    const start = now();
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      if (now() - start > deadlineMs) break;
      try { return await fn(i + 1); } catch (e) { lastErr = e; }
      await sleep(jitter(baseMs * Math.pow(2, i))); // 120ms, 240ms, 480ms (+jitter)
    }
    if (lastErr) throw lastErr;
    return null;
  }

  // Model/menu utilities
  function getModelTrigger() {
    // Prefers explicit label; falls back to haspopup=menu
    return document.querySelector('button[aria-label*="Model selector" i]') ||
           document.querySelector('button[aria-haspopup="menu"]');
  }

  function getOpenMenuRoot() {
    // Radix portals typically mark data-state="open". Prefer last visible portal to avoid selecting wrong menu.
    const portals = [...document.querySelectorAll('[data-radix-portal] [role="menu"], [data-radix-portal] [data-state="open"]')].filter(isVisible);
    return portals.at(-1) || document.querySelector('[role="menu"][data-orientation="vertical"][data-state="open"]') || null;
  }

  function findMenuItemByText(root, regex) {
    if (!root) return null;
    const items = root.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button');
    for (const it of items) {
      const t = normalizeText(it.textContent);
      if (regex.test(t)) return it;
    }
    return null;
  }

  function researchRegex() {
    // covers "Pro Research", "Deep Research", "Research-grade intelligence"
    return /(?:\b(?:pro\s*)?(?:deep\s*)?research(?:-grade)?\b)/i;
  }

  function modelLabelIndicatesResearch(btn) {
    const txt = normalizeText(btn?.getAttribute('aria-label') || btn?.textContent || '');
    return /(?:\b(?:current model is\s*)?(?:pro\s*)?(?:deep\s*)?research(?:-grade)?\b)/i.test(txt);
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
          console.log('🚀 Enabling Research: starting');
          const deadlineMs = 14000;

          // 0) CDP trusted click with 3x retries (most reliable on fresh pages)
          try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
              // Try CDP up to 3 times with increasing delays for page load
              for (let cdpAttempt = 1; cdpAttempt <= 3; cdpAttempt++) {
                console.log(`[CDP] Attempt ${cdpAttempt}/3: Requesting background Research activation…`);

                // Wait longer on each retry for page to fully load
                if (cdpAttempt > 1) {
                  const delayMs = cdpAttempt * 800; // 800ms, 1600ms
                  console.log(`[CDP] Waiting ${delayMs}ms for page to stabilize...`);
                  await sleep(delayMs);
                }

                // Safer promise wrapper for MV3 compatibility
                const resp = await new Promise((resolve) => {
                  try {
                    chrome.runtime.sendMessage({ type: 'llmburst-chatgpt-enable-research', timeoutMs: 8000 }, resolve);
                  } catch (e) {
                    resolve(null);
                  }
                });

                if (resp?.ok) {
                  // If background CDP already positively verified activation, trust it
                  if (resp.activated === true) {
                    console.log(`✅ [CDP] Background reports Research activated on attempt ${cdpAttempt}`);
                    return true;
                  }
                  const verified = await verifyResearchActive({ deadlineMs: 4000 });
                  if (verified) {
                    console.log(`✅ [CDP] Research activated successfully on attempt ${cdpAttempt}`);
                    return true;
                  }
                  console.warn(`[CDP] Attempt ${cdpAttempt}: Click sequence ok but verification failed`);
                } else {
                  console.warn(`[CDP] Attempt ${cdpAttempt}: Background returned error:`, resp?.error || 'unknown');
                }
              }
              console.log('[CDP] All 3 attempts failed, falling back to other methods...');
            }
          } catch (e) {
            console.warn('[CDP] Exception:', e);
          }

          // 1) Primary: Model selector menu
          try {
            const ok = await withRetries(async (attempt) => {
              console.log(`[ModelMenu] Attempt ${attempt}`);
              let trigger = await waitForVisible('button[aria-label*="Model selector" i], button[aria-haspopup="menu"]', { timeoutMs: 5000 });
              if (!trigger) throw Object.assign(new Error('E_MODEL_TRIGGER_NOT_FOUND'), { code: 'E_MODEL_TRIGGER_NOT_FOUND' });

              await clickInteractable(trigger);

              // Wait for Radix menu to be open and stable
              const menuOpen = await waitForMenuOpenStable({ timeoutMs: 4000 });
              if (!menuOpen) throw Object.assign(new Error('E_MENU_NOT_OPEN'), { code: 'E_MENU_NOT_OPEN' });

              // Require at least a few items and stability
              const item = findMenuItemByText(menuOpen, researchRegex());
              if (!item) {
                // If not found, let it stabilize a bit more and retry once per attempt
                await waitForStableSubtree(menuOpen, { stableForMs: 220, timeoutMs: 1200 });
              }
              const researchItem = findMenuItemByText(menuOpen, researchRegex());
              if (!researchItem) throw Object.assign(new Error('E_OPTION_NOT_FOUND'), { code: 'E_OPTION_NOT_FOUND' });

              await clickInteractable(researchItem);

              // Menu likely closes; Verify by label or re-open to check aria-checked
              const verified = await verifyResearchActive({ deadlineMs: 5000 });
              if (!verified) throw Object.assign(new Error('E_VERIFY_FAILED'), { code: 'E_VERIFY_FAILED' });

              return true;
            }, { tries: 3, baseMs: 140, deadlineMs });
            if (ok) return true;
          } catch (e) {
            console.warn('[ModelMenu] Failed:', e?.code || e);
          }

          // 2) Secondary: Model selector with keyboard navigation
          try {
            const ok = await withRetries(async (attempt) => {
              console.log(`[ModelKB] Attempt ${attempt}`);
              const trigger = await waitForVisible('button[aria-label*="Model selector" i], button[aria-haspopup="menu"]', { timeoutMs: 4000 });
              if (!trigger) throw new Error('E_MODEL_TRIGGER_NOT_FOUND');

              await clickInteractable(trigger);
              const menu = await waitForMenuOpenStable({ timeoutMs: 3000 });
              if (!menu) throw new Error('E_MENU_NOT_OPEN');

              // Ensure first item is focused
              const target = menu.contains(document.activeElement) ? document.activeElement : menu.querySelector('[role="menuitem"],[role="menuitemradio"],[role="option"]');
              target?.focus();

              // Try typeahead "r" or "p" first
              const keys = ['r','p'];
              for (const k of keys) {
                const keyTarget = document.activeElement || target;
                keyTarget?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
                await sleep(100);
                const active = document.activeElement;
                if (active && researchRegex().test(normalizeText(active.textContent))) {
                  active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                  const okv = await verifyResearchActive({ deadlineMs: 4000 });
                  if (okv) return true;
                }
              }

              // Fallback: iterate a few ArrowDowns
              for (let i = 0; i < 15; i++) {
                const keyTarget = document.activeElement || target;
                keyTarget?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
                await sleep(60);
                const active = document.activeElement;
                if (active && researchRegex().test(normalizeText(active.textContent))) {
                  active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                  const okv = await verifyResearchActive({ deadlineMs: 4000 });
                  if (okv) return true;
                }
              }

              throw new Error('E_OPTION_NOT_FOUND');
            }, { tries: 2, baseMs: 180, deadlineMs: 8000 });
            if (ok) return true;
          } catch (e) {
            console.warn('[ModelKB] Failed:', e?.code || e);
          }

          // 3) Composer "+" → Deep research menu
          try {
            const ok = await selectViaComposerPlus();
            if (ok) return true;
          } catch (e) {
            console.warn('[PlusMenu] Failed:', e);
          }

          // 4) Slash command fallback
          try {
            const ok = await slashCommandFallback();
            if (ok) return true;
          } catch (e) {
            console.warn('[Slash] Failed:', e);
          }

          console.warn('Research activation failed after all strategies.');
          return false;

          // ---- local helpers ----
          async function waitForMenuOpenStable({ timeoutMs = 4000 } = {}) {
            const start = now();
            while (now() - start < timeoutMs) {
              const menu = getOpenMenuRoot();
              if (menu && isVisible(menu)) {
                const ok = await waitForStableSubtree(menu, { stableForMs: 180, timeoutMs: Math.max(250, timeoutMs - (now() - start)) });
                if (ok) return menu;
              }
              await sleep(50);
            }
            return null;
          }

          async function verifyResearchActive({ deadlineMs = 5000 } = {}) {
            const start = now();

            // Strong signal 0: Composer pill indicating Research mode
            const hasResearchPill = () => {
              // Look for an explicit composer mode pill or tag labelled "Research"
              const nodes = document.querySelectorAll(
                'button.__composer-pill[aria-label*="research" i], [aria-label*="research" i].__composer-pill, .composer-mode-pill, [data-testid*="research" i]'
              );
              for (const n of nodes) {
                if (!isVisible(n)) continue;
                const t = normalizeText((n.textContent || '') + ' ' + (n.getAttribute('aria-label') || ''));
                if (/\bresearch\b/i.test(t)) return true;
              }
              return false;
            };

            // 1) Poll for the composer Research pill first (label updates can lag)
            while (now() - start < deadlineMs) {
              if (hasResearchPill()) {
                console.log('✅ Research verified via composer pill');
                return true;
              }
              // Also check model selector label in the same loop
              const btn = getModelTrigger();
              if (btn && modelLabelIndicatesResearch(btn)) {
                console.log('✅ Research verified via model button label');
                return true;
              }
              await sleep(180);
            }

            // 2) As a fallback, re-open the model menu and check aria-checked
            try {
              const trigger = getModelTrigger();
              if (trigger) {
                await clickInteractable(trigger);
                const menu = await waitForMenuOpenStable({ timeoutMs: 1200 });
                if (menu) {
                  const checkedItem = menu.querySelector('[role="menuitemradio"][aria-checked="true"], [role="menuitem"][aria-selected="true"]');
                  if (checkedItem && researchRegex().test(normalizeText(checkedItem.textContent))) {
                    console.log('✅ Research verified via menu aria-checked');
                    // Close menu - try multiple approaches
                    try { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
                    try { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}
                    try { document.body.click(); } catch {}
                    return true;
                  }
                }
              }
            } catch {}
            return false;
          }

          async function selectViaComposerPlus() {
            let plusButton = document.querySelector('[data-testid="composer-plus-btn"]');
            if (!plusButton) {
              const buttons = document.querySelectorAll('button');
              for (const button of buttons) {
                const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
                const hasIcon = button.querySelector('svg path[d*="M12 5v14M5 12h14"]') ||
                               button.querySelector('svg path[d*="M19 12h-14M12 19v-14"]');
                if (ariaLabel.includes('attach') || ariaLabel.includes('plus') || ariaLabel.includes('more') || hasIcon) {
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
            if (!plusButton) return false;

            console.log('[PlusMenu] Found plus button, clicking...');
            await clickInteractable(plusButton);

            const menu = await waitForVisible('[role="menu"], [data-radix-portal], [role="listbox"], .popover-content, [data-state="open"]', { timeoutMs: 3000 });
            if (!menu) return false;

            await waitForStableSubtree(menu, { stableForMs: 150, timeoutMs: 1000 });

            const deepResearchItem = findMenuItemByText(menu, /\b(deep\s*)?research\b/i);
            if (!deepResearchItem) return false;

            console.log('[PlusMenu] Clicking Deep research option...');
            await clickInteractable(deepResearchItem);
            return await verifyResearchActive({ deadlineMs: 4000 });
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
