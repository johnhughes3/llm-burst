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

  const simulateButtonClick = typeof u.simulateButtonClick === 'function'
    ? u.simulateButtonClick.bind(u)
    : (element) => {
        if (!(element instanceof HTMLElement)) return;
        try { element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
        const rect = element.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        };
        try { element.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch {}
        try { element.dispatchEvent(new MouseEvent('mousedown', opts)); } catch {}
        try { element.dispatchEvent(new PointerEvent('pointerup', opts)); } catch {}
        try { element.dispatchEvent(new MouseEvent('mouseup', opts)); } catch {}
        try { element.dispatchEvent(new MouseEvent('click', opts)); } catch {}
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

  async function waitForSubmissionAccepted(editor, timeout = 2500, interval = 120) {
    try {
      await waitUntil(() => {
        const candidate = findSendButtonCandidate({ requireEnabled: false });
        if (editor instanceof HTMLElement && editorTextMatches(editor, '')) return true;
        if (!candidate || isDisabled(candidate)) return true;
        const bodyText = normalizeWhitespace(document.body?.innerText || document.body?.textContent || '');
        if (/\b(start|begin|confirm)\s+(deep\s+)?research\b/i.test(bodyText)) return true;
        if (/\b(generating|researching|thinking|stop generating)\b/i.test(bodyText)) return true;
        return null;
      }, timeout, interval);
      return true;
    } catch {
      return false;
    }
  }

  async function clickSendButton(sendButton, editor) {
    if (!(sendButton instanceof HTMLElement)) return false;
    try { sendButton.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
    await wait(40);
    simulateButtonClick(sendButton);
    await wait(250);
    if (await waitForSubmissionAccepted(editor, 1500)) return true;

    try { sendButton.click(); } catch {}
    await wait(250);
    return waitForSubmissionAccepted(editor, 2500);
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
      const accepted = await clickSendButton(sendButton, editor);
      if (accepted) {
        return { ok: true, warnings };
      }
      warnings.push('Gemini send button click did not appear to submit the prompt; attempting keyboard fallback');
    }

    if (!sendButton) {
      warnings.push('Gemini send button not found or disabled; attempting keyboard fallback');
    }
    const keyboardSent = await triggerKeyboardSendFallback(editor);
    const keyboardAccepted = keyboardSent && await waitForSubmissionAccepted(editor, 2500);
    if (!keyboardAccepted) {
      warnings.push('Gemini keyboard fallback did not confirm message submission');
      return {
        ok: false,
        error: 'Gemini send action could not be confirmed',
        warnings
      };
    }

    return { ok: true, warnings };
  }

  const GEMINI_MODEL_MATCHERS = {
    deepThink: {
      label: 'Pro Deep Think',
      option: /\bdeep\s*think\b/i,
      familyOption: /\b(?:gemini\s*)?(?:\d+(?:\.\d+)?\s*)?pro\b/i,
      selector: /\b(mode|model|gemini|advanced|flash|pro|deep\s*think)\b/i,
    },
    pro: {
      label: 'Pro',
      option: /\b(?:gemini\s*)?(?:\d+(?:\.\d+)?\s*)?pro\b/i,
      familyOption: /\b(?:gemini\s*)?(?:\d+(?:\.\d+)?\s*)?pro\b/i,
      selector: /\b(mode|model|gemini|advanced|flash|pro|deep\s*think)\b/i,
    },
  };

  function getElementLabel(element) {
    if (!(element instanceof HTMLElement)) return '';
    return normalizeWhitespace(
      [
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('data-model') || '',
        element.getAttribute('data-value') || '',
        element.textContent || '',
      ].join(' ')
    );
  }

  function getModelSelectorButton(preferredModel) {
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    const excluded = /\b(tools?|toolbox|canvas|research|send|temporary|upload|attach)\b/i;
    const directSelectors = [
      'button[aria-label*="mode picker" i]',
      'button[aria-label*="model" i]',
      'button[aria-label*="currently" i]',
      '[role="button"][aria-label*="mode picker" i]',
      '[role="button"][aria-label*="model" i]',
      '[role="button"][aria-label*="currently" i]',
    ];

    for (const selector of directSelectors) {
      const direct = Array.from(document.querySelectorAll(selector)).find((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (!visible(element)) return false;
        const label = getElementLabel(element);
        return label && !excluded.test(label);
      });
      if (direct instanceof HTMLElement) return direct;
    }

    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((button) => {
      const label = getElementLabel(button);
      if (!label || excluded.test(label)) return false;
      return config.selector.test(label);
    }) || null;
  }

  function getClickableAncestor(element) {
    if (!(element instanceof HTMLElement)) return null;
    return element.closest(
      [
        'button',
        '[role="button"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="radio"]',
        '[tabindex]:not([tabindex="-1"])',
        '[jsaction]',
        '[data-model]',
        '.model-option',
        '.mat-mdc-menu-item',
        '.mat-mdc-option',
      ].join(',')
    ) || element;
  }

  function collectClickableCandidates() {
    const candidates = [];
    const seen = new Set();
    const elements = Array.from(document.querySelectorAll([
      'button',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="radio"]',
      '[tabindex]:not([tabindex="-1"])',
      '[jsaction]',
      '[data-model]',
      '.model-option',
      '.mat-mdc-menu-item',
      '.mat-mdc-option',
      '[aria-label]',
    ].join(',')));

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!visible(element)) continue;
      const clickable = getClickableAncestor(element);
      if (!(clickable instanceof HTMLElement)) continue;
      if (!visible(clickable)) continue;
      if (seen.has(clickable)) continue;
      candidates.push(clickable);
      seen.add(clickable);
    }

    return candidates;
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element;
    while (current && current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function collectVisibleTextCandidates() {
    const seen = new Set();
    const candidates = [];
    const elements = Array.from(document.querySelectorAll('body *'));

    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (!visible(element)) continue;

      const label = getElementLabel(element);
      if (!label || label.length > 240) continue;

      const clickable = getClickableAncestor(element);
      if (!(clickable instanceof HTMLElement)) continue;
      if (!visible(clickable)) continue;

      const key = clickable;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        element: clickable,
        label: getElementLabel(clickable) || label,
        labelLength: label.length,
        depth: elementDepth(element),
      });
    }

    candidates.sort((a, b) => {
      if (a.labelLength !== b.labelLength) return a.labelLength - b.labelLength;
      return b.depth - a.depth;
    });

    return candidates;
  }

  function findClickableByLabel(match, { exclude = null, allowTextFallback = true } = {}) {
    const candidates = collectClickableCandidates();
    const direct = candidates.find((candidate) => {
      const label = getElementLabel(candidate);
      if (!label) return false;
      if (exclude && exclude.test(label)) return false;
      return match.test(label);
    });
    if (direct) return direct;
    if (!allowTextFallback) return null;

    const textCandidates = collectVisibleTextCandidates();
    const textMatch = textCandidates.find((candidate) => {
      if (!candidate.label) return false;
      if (exclude && exclude.test(candidate.label)) return false;
      return match.test(candidate.label);
    });
    return textMatch ? textMatch.element : null;
  }

  function getModelOptionElement(preferredModel) {
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    const exclude = preferredModel === 'pro' ? /\b(deep\s*think|extended|flash)\b/i : null;
    return findClickableByLabel(config.option, {
      exclude,
      allowTextFallback: preferredModel !== 'deepThink',
    });
  }

  function getCurrentModelLabel(preferredModel) {
    const selector = getModelSelectorButton(preferredModel);
    return selector ? getElementLabel(selector) : '';
  }

  function pageIndicatesModel(preferredModel) {
    const label = getCurrentModelLabel(preferredModel);
    if (!label) return false;
    if (preferredModel === 'deepThink') return /\bdeep\s*think\b/i.test(label);
    if (preferredModel === 'pro') {
      return /\bpro\b/i.test(label) && !/\b(deep\s*think|extended)\b/i.test(label);
    }
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    return config.option.test(label);
  }

  async function openModelMenu(preferredModel) {
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    const modelButton = getModelSelectorButton(preferredModel);

    if (!modelButton) {
      throw new Error(`Gemini model selector not found for ${config.label}`);
    }

    console.log('Found Gemini model selector button, clicking it');
    modelButton.click();
    await wait(500);
    return modelButton;
  }

  async function selectProFamily(preferredModel, { required = false } = {}) {
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    const currentLabel = getCurrentModelLabel(preferredModel);
    if (/\bpro\b/i.test(currentLabel)) return { ok: true, selected: false, alreadyActive: true };

    await openModelMenu(preferredModel);

    const option = findClickableByLabel(config.familyOption || config.option, {
      exclude: /\b(deep\s*think|extended|flash)\b/i,
    });

    if (!option) {
      const message = `Gemini Pro model option not found`;
      try { document.body.click(); } catch {}
      await wait(300);
      if (required) throw new Error(message);
      return { ok: false, selected: false, warning: message };
    }

    console.log('Found Gemini Pro model option, clicking it');
    option.click();
    await wait(600);
    return { ok: true, selected: true };
  }

  async function selectThinkingLevel(level, { required = false } = {}) {
    const normalizedLevel = String(level || '').trim();
    if (!normalizedLevel) return { ok: true, selected: false };

    const target =
      normalizedLevel === 'Deep Think'
        ? /\bdeep\s*think\b/i
        : new RegExp(`\\b${normalizedLevel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

    const currentLabel = getCurrentModelLabel('deepThink') || getCurrentModelLabel('pro');
    if (target.test(currentLabel) && normalizedLevel === 'Deep Think') {
      return { ok: true, selected: false, alreadyActive: true };
    }
    if (normalizedLevel === 'Standard' && pageIndicatesModel('pro')) {
      return { ok: true, selected: false, alreadyActive: true };
    }

    await openModelMenu(normalizedLevel === 'Deep Think' ? 'deepThink' : 'pro');

    const thinkingMenu = findClickableByLabel(/\bthinking\s+level\b/i);
    if (thinkingMenu) {
      console.log('Opening Gemini thinking level submenu');
      thinkingMenu.click();
      await wait(400);
    }

    const option = findClickableByLabel(target, {
      exclude: normalizedLevel === 'Standard' ? /\b(deep\s*think|extended)\b/i : null,
    });

    if (!option) {
      const message = `Gemini ${normalizedLevel} thinking option not found`;
      try { document.body.click(); } catch {}
      await wait(300);
      if (required) throw new Error(message);
      return { ok: false, selected: false, warning: message };
    }

    console.log(`Found Gemini ${normalizedLevel} thinking option, clicking it`);
    option.click();
    await wait(700);
    return { ok: true, selected: true };
  }

  async function selectPreferredModel(preferredModel = 'deepThink', { required = false } = {}) {
    const config = GEMINI_MODEL_MATCHERS[preferredModel] || GEMINI_MODEL_MATCHERS.deepThink;
    if (pageIndicatesModel(preferredModel)) {
      return { ok: true, selected: false, alreadyActive: true };
    }

    console.log(`Looking for Gemini model selector for ${config.label}`);

    if (preferredModel === 'deepThink') {
      await openModelMenu(preferredModel);
      const flatOption = getModelOptionElement(preferredModel);
      if (flatOption) {
        console.log(`Found flat Gemini ${config.label} option, clicking it`);
        flatOption.click();
        await wait(700);
      } else {
        try { document.body.click(); } catch {}
        await wait(200);
        await selectProFamily(preferredModel, { required });
        await selectThinkingLevel('Deep Think', { required });
      }
    } else if (preferredModel === 'pro') {
      await selectProFamily(preferredModel, { required });
      await selectThinkingLevel('Standard', { required: false });
    } else {
      await openModelMenu(preferredModel);
      const option = getModelOptionElement(preferredModel);
      if (!option) {
        const message = `Gemini ${config.label} option not found`;
        try { document.body.click(); } catch {}
        await wait(300);
        if (required) throw new Error(message);
        console.log(`${message}; proceeding with current model`);
        return { ok: false, selected: false, warning: message };
      }
      console.log(`Found Gemini ${config.label} option, clicking it`);
      option.click();
      await wait(500);
    }

    if (!pageIndicatesModel(preferredModel)) {
      const message = `Gemini ${config.label} selection could not be confirmed`;
      if (required) throw new Error(message);
      return { ok: false, selected: true, warning: message };
    }

    return { ok: true, selected: true };
  }

  async function selectModelAndProceed(
    messageText,
    { preferredModel = 'deepThink', requiredModel = false } = {}
  ) {
    try {
      const modelResult = await selectPreferredModel(preferredModel, { required: requiredModel });
      const result = await addTextAndSend(messageText);
      if (modelResult.warning) {
        result.warnings = [modelResult.warning, ...(result.warnings || [])];
      }
      return result;
    } catch (error) {
      throw new Error(`Error selecting model: ${error}`);
    }
  }

  async function selectModelAndPasteOnly(messageText, { preferredModel = 'pro' } = {}) {
    try {
      await selectPreferredModel(preferredModel, { required: false });
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
                               const text = normalizeWhitespace(b.textContent || '').toLowerCase();
                               const aria = normalizeWhitespace(b.getAttribute('aria-label') || '').toLowerCase();
                               const classes = b.className || '';
                               const label = `${text} ${aria}`;
                               if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
                               if (/\btry again without deep research\b/.test(label)) return false;
                               return /\b(start|begin|confirm|continue|proceed)\s+(deep\s+)?research\b/.test(label) ||
                                      /\b(confirm|continue|proceed)\b/.test(label) && classes.includes('confirm-button');
                             });

        if (confirmButton && !confirmButton.disabled && confirmButton.getAttribute('aria-disabled') !== 'true') {
          console.log(`Found Deep Research confirm button after ${(i * 500) / 1000} seconds, clicking...`);
          simulateButtonClick(confirmButton);
          await wait(250);
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

  async function automateGeminiChat(messageText, enableResearch, enableIncognito, runtimeOptions = {}) {
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
        const researchSuccess = runtimeOptions.geminiPreconfiguredResearch
          ? true
          : await enableDeepResearch();

        if (researchSuccess) {
          // Successfully enabled Deep Research, continue with model selection and submission
          const result = await selectModelAndProceed(messageText, {
            preferredModel: 'pro',
            requiredModel: false,
          });
          if (isResearchMode) {
            const confirmed = await waitForAndClickResearchConfirm();
            if (!confirmed) {
              result.warnings = [
                ...(result.warnings || []),
                'Gemini Deep Research plan was submitted but the Start research button was not confirmed',
              ];
            }
          }
          return result;
        }

        // Failed to enable Deep Research - paste text but DON'T submit
        console.log('⚠️ Could not enable Deep Research mode. Pasting prompt without submitting.');
        return await selectModelAndPasteOnly(messageText, { preferredModel: 'pro' });
      } else {
        console.log('Regular mode requested, will use Gemini Deep Think');
        return await selectModelAndProceed(messageText, {
          preferredModel: 'deepThink',
          requiredModel: true,
        });
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
      return automateGeminiChat(String(prompt || ''), research, incognito, {
        geminiPreconfiguredResearch: !!(options && options.geminiPreconfiguredResearch),
      });
    },
    followup: async ({ prompt }) => {
      await ensureEditorReady(15000).catch(() => {});
      return geminiFollowUpMessage(String(prompt || ''));
    }
  };

  try { console.debug('LLM Burst Gemini injector loaded'); } catch {}
})();
