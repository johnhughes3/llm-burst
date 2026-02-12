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

  const visible = typeof u.visible === 'function'
    ? u.visible.bind(u)
    : (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const opacity = Number(style.opacity);
        if (Number.isFinite(opacity) && opacity === 0) return false;
        const rect = el.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };

  const simulateFocusSequence = typeof u.simulateFocusSequence === 'function'
    ? u.simulateFocusSequence.bind(u)
    : (element) => {
        if (!element) return;
        try { element.focus({ preventScroll: true }); } catch {
          try { element.focus(); } catch { /* ignore */ }
        }
      };

  const setContentEditableText = typeof u.setContentEditableText === 'function'
    ? u.setContentEditableText.bind(u)
    : (element, text) => {
        if (!element) throw new Error('setContentEditableText fallback: no element provided');
        const normalizedText = String(text ?? '');
        const editableMode = String(
          element.getAttribute('contenteditable') || element.contentEditable || ''
        ).toLowerCase();
        if (editableMode === 'plaintext-only') {
          element.textContent = normalizedText;
          try {
            element.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: normalizedText
            }));
          } catch {
            try { element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
          }
          return;
        }
        while (element.firstChild) element.removeChild(element.firstChild);
        const lines = normalizedText.split('\n');
        for (const line of lines) {
          const p = document.createElement('p');
          p.textContent = line || '\u00A0';
          element.appendChild(p);
        }
        try { element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
      };

  const setTextareaText = typeof u.setTextareaText === 'function'
    ? u.setTextareaText.bind(u)
    : (textarea, text) => {
        if (!(textarea instanceof HTMLTextAreaElement)) {
          throw new Error('setTextareaText fallback: expected textarea element');
        }
        textarea.value = String(text);
        try { textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true })); } catch {}
        try {
          const end = textarea.value.length;
          textarea.selectionStart = textarea.selectionEnd = end;
        } catch {
          /* ignore */
        }
      };

  const isDisabled = typeof u.isDisabled === 'function'
    ? u.isDisabled.bind(u)
    : (btn) => {
        if (!btn) return true;
        if (btn.disabled) return true;
        const aria = btn.getAttribute?.('aria-disabled');
        if (aria === 'true') return true;
        if (btn.classList?.contains('disabled')) return true;
        const style = window.getComputedStyle(btn);
        if (style.pointerEvents === 'none') return true;
        return false;
      };

  const EDITOR_PRIMARY_SELECTORS = [
    '.ql-editor',
    '[data-lexical-editor="true"][contenteditable="true"]',
    '[data-lexical-editor="true"][contenteditable="plaintext-only"]',
    '[role="textbox"][contenteditable="true"]',
    '[role="textbox"][contenteditable="plaintext-only"]',
    '[contenteditable="true"][aria-label*="Gemini" i]',
    '[contenteditable="plaintext-only"][aria-label*="Gemini" i]',
    '[contenteditable="true"][aria-label*="message" i]',
    '[contenteditable="plaintext-only"][aria-label*="message" i]',
    'textarea[aria-label*="Gemini" i]',
    'textarea[aria-label*="message" i]',
    'textarea[name="message"]',
    'textarea[data-testid*="chat-input"]',
    'textarea[data-testid*="composer"]',
  ];

  const EDITOR_FALLBACK_SELECTORS = [
    '[role="textbox"][contenteditable]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[contenteditable]:not([contenteditable="false"])',
    'textarea',
  ];

  function isEditableCandidate(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!visible(node)) return false;
    if (node instanceof HTMLTextAreaElement) {
      if (node.disabled) return false;
      if (node.hasAttribute('readonly')) return false;
      return true;
    }
    const editable = node.getAttribute('contenteditable');
    if (editable && editable.toLowerCase() === 'false') return false;
    if (node.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function collectEditorCandidates() {
    const seen = new Set();
    const collected = [];
    const push = (el, priority) => {
      if (!(el instanceof HTMLElement)) return;
      if (seen.has(el)) return;
      if (!isEditableCandidate(el)) return;
      collected.push({ el, priority });
      seen.add(el);
    };

    for (const selector of EDITOR_PRIMARY_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        push(node, 0);
      }
    }
    for (const selector of EDITOR_FALLBACK_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        push(node, 1);
      }
    }

    collected.sort((a, b) => a.priority - b.priority);
    return collected.map((entry) => entry.el);
  }

  function pickEditorCandidate() {
    const candidates = collectEditorCandidates();
    return candidates.length > 0 ? candidates[0] : null;
  }

  async function ensureEditorReady(timeout = 15000, interval = 120) {
    try {
      const editor = await waitUntil(() => pickEditorCandidate(), timeout, interval);
      return editor instanceof HTMLElement ? editor : null;
    } catch {
      return null;
    }
  }

  function normalizeWhitespace(value) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function editorTextMatches(element, expected) {
    if (!(element instanceof HTMLElement)) return false;
    const target = normalizeWhitespace(expected);
    if (element instanceof HTMLTextAreaElement) {
      const actual = normalizeWhitespace(element.value);
      if (!target) return actual === '';
      return actual.includes(target);
    }
    const textContent = element.innerText || element.textContent || '';
    const actual = normalizeWhitespace(textContent);
    if (!target) return actual === '';
    return actual.includes(target);
  }

  async function tryExecCommandInsert(element, text) {
    if (!(element instanceof HTMLElement)) return false;
    try {
      element.focus({ preventScroll: true });
    } catch {
      try { element.focus(); } catch { /* ignore */ }
    }
    await wait(20);
    try { document.execCommand('selectAll', false); } catch { /* ignore */ }
    await wait(10);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, String(text || ''));
    } catch {
      inserted = false;
    }
    await wait(60);
    return inserted || editorTextMatches(element, text);
  }

  async function applyTextToEditor(element, text, warnings) {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Gemini editor element not found');
    }
    simulateFocusSequence(element);
    await wait(40);

    if (element instanceof HTMLTextAreaElement) {
      setTextareaText(element, text);
      return;
    }

    try {
      setContentEditableText(element, text);
    } catch (error) {
      warnings.push(`Gemini editor text insert error: ${String(error ?? 'unknown error')}`);
    }

    if (editorTextMatches(element, text)) {
      return;
    }

    const execOk = await tryExecCommandInsert(element, text);
    if (execOk) {
      return;
    }

    try {
      element.textContent = String(text ?? '');
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } catch {
      /* ignore */
    }

    if (!editorTextMatches(element, text)) {
      warnings.push('Gemini editor did not confirm text insertion');
    }
  }

  const SEND_BUTTON_SELECTORS = [
    'button.send-button',
    'button[data-testid*="send"]',
    '[role="button"][data-testid*="send"]',
    'button[aria-label*="send" i]',
    '[role="button"][aria-label*="send" i]',
    'button[aria-label*="submit" i]',
    'button[type="submit"]',
  ];

  function getSendButtonCandidates() {
    const seen = new Set();
    const candidates = [];
    const push = (el) => {
      if (!(el instanceof HTMLElement)) return;
      if (seen.has(el)) return;
      if (!visible(el)) return;
      candidates.push(el);
      seen.add(el);
    };

    for (const sel of SEND_BUTTON_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        push(node);
        const button = node.closest('button, [role="button"]');
        if (button instanceof HTMLElement) push(button);
      }
    }

    const fallbackButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const btn of fallbackButtons) {
      if (!(btn instanceof HTMLElement)) continue;
      const text = (btn.textContent || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('send') || aria.includes('send') || text.includes('submit')) {
        push(btn);
      }
    }

    return candidates;
  }

  function findSendButtonCandidate({ requireEnabled = false } = {}) {
    const candidates = getSendButtonCandidates();
    for (const btn of candidates) {
      if (requireEnabled && isDisabled(btn)) continue;
      return btn;
    }
    return null;
  }

  async function waitForSendButtonEnabled(timeout = 9000, interval = 120) {
    try {
      const button = await waitUntil(() => {
        const candidate = findSendButtonCandidate();
        if (candidate && !isDisabled(candidate)) return candidate;
        return null;
      }, timeout, interval);
      return button instanceof HTMLElement ? button : null;
    } catch {
      return null;
    }
  }

  async function triggerKeyboardSendFallback(editor) {
    const target =
      (editor && editor.isConnected ? editor : document.activeElement) ||
      document.body ||
      document.documentElement;
    if (!(target instanceof HTMLElement)) return false;
    const combos = [
      { key: 'Enter', code: 'Enter' },
      { key: 'Enter', code: 'Enter', metaKey: true },
      { key: 'Enter', code: 'Enter', ctrlKey: true },
    ];
    for (const combo of combos) {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...combo }));
        target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...combo }));
      } catch {
        /* ignore */
      }
      await wait(200);
      const candidate = findSendButtonCandidate({ requireEnabled: false });
      if (!candidate || isDisabled(candidate)) {
        return true;
      }
      if (editor instanceof HTMLElement && editorTextMatches(editor, '')) {
        return true;
      }
    }
    return false;
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

  async function addTextAndSend(messageText) {
    const warnings = [];
    const editor = await ensureEditorReady(15000);
    if (!editor) {
      throw new Error('Gemini editor element not found');
    }

    await applyTextToEditor(editor, messageText, warnings);

    const sendButton = await waitForSendButtonEnabled(9000);
    if (sendButton) {
      try { sendButton.click(); } catch {}
      return { ok: true, warnings };
    }

    warnings.push('Gemini send button not found or disabled; attempting keyboard fallback');
    const keyboardSent = await triggerKeyboardSendFallback(editor);
    if (!keyboardSent) {
      warnings.push('Gemini keyboard fallback did not confirm message submission');
      return {
        ok: false,
        error: 'Gemini send action could not be confirmed',
        warnings
      };
    }

    return { ok: true, warnings };
  }

  async function selectModelAndProceed(messageText) {
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
        return await addTextAndSend(messageText);
      }

      console.log('Found model selector button, clicking it');
      modelButton.click();
      await wait(500);

      console.log('Looking for 2.5 Pro button in dropdown');
      const proButtons = Array.from(document.querySelectorAll('button'))
        .filter(button => {
          const text = button.textContent || '';
          return text.includes('2.5 Pro');
        });

      const proButton = proButtons[0];

      if (!proButton) {
        console.log('2.5 Pro button not found, proceeding with current model');
        try { document.body.click(); } catch {}
        await wait(300);
        return await addTextAndSend(messageText);
      }

      console.log('Found 2.5 Pro button, clicking it');
      proButton.click();
      await wait(500);
      return await addTextAndSend(messageText);
    } catch (error) {
      throw new Error(`Error selecting model: ${error}`);
    }
  }

  async function selectModelAndPasteOnly(messageText) {
    try {
      console.log('Looking for model selector button (paste-only mode)');
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
        return await addTextOnly(messageText);
      }

      console.log('Found model selector button, clicking it');
      modelButton.click();
      await wait(500);

      console.log('Looking for 2.5 Pro button in dropdown');
      const proButtons = Array.from(document.querySelectorAll('button'))
        .filter(button => {
          const text = button.textContent || '';
          return text.includes('2.5 Pro');
        });

      const proButton = proButtons[0];

      if (!proButton) {
        console.log('2.5 Pro button not found, proceeding with current model');
        try { document.body.click(); } catch {}
        await wait(300);
        return await addTextOnly(messageText);
      }

      console.log('Found 2.5 Pro button, clicking it');
      proButton.click();
      await wait(500);
      return await addTextOnly(messageText);
    } catch (error) {
      throw new Error(`Error selecting model: ${error}`);
    }
  }

  async function addTextOnly(messageText) {
    const warnings = [];
    const editor = await ensureEditorReady(15000);
    if (!editor) {
      throw new Error('Gemini editor element not found');
    }

    await applyTextToEditor(editor, messageText, warnings);
    warnings.push('Text pasted without submission (Deep Research activation failed)');
    return { ok: true, warnings, pastedOnly: true, reason: 'Deep Research activation failed' };
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
          const result = await selectModelAndProceed(messageText);
          // After successful submission in research mode, start waiting for confirm button
          // This is non-blocking - we don't await it
          if (isResearchMode) {
            waitForAndClickResearchConfirm().catch(err => {
              console.log('Non-critical error in research confirm:', err);
            });
          }
          return result;
        }

        // Failed to enable Deep Research - paste text but DON'T submit
        console.log('⚠️ Could not enable Deep Research mode. Pasting prompt without submitting.');
        return await selectModelAndPasteOnly(messageText);
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
        return await selectModelAndProceed(messageText);
      }
    } catch (error) {
      throw new Error(`Error in automation process: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Ported logic: geminiFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  async function geminiFollowUpMessage(messageText) {
    return await addTextAndSend(messageText);
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
