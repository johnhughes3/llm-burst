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

  const visible =
    typeof u.visible === 'function'
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

  const scrollIntoViewIfNeeded =
    typeof u.scrollIntoViewIfNeeded === 'function'
      ? u.scrollIntoViewIfNeeded.bind(u)
      : (el) => {
          if (!el) return;
          try {
            const rect = el.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
            if (
              rect.top < 0 ||
              rect.left < 0 ||
              rect.bottom > viewportHeight ||
              rect.right > viewportWidth
            ) {
              el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            }
          } catch {
            try {
              el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
            } catch {
              /* ignore */
            }
          }
        };

  const simulateButtonClick =
    typeof u.simulateButtonClick === 'function'
      ? u.simulateButtonClick.bind(u)
      : (element) => {
          if (!element) return;
          scrollIntoViewIfNeeded(element);
          const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
          for (const type of events) {
            try {
              const EventCtor =
                type === 'pointerdown' || type === 'pointerup' ? PointerEvent : MouseEvent;
              const ev = new EventCtor(type, { bubbles: true, cancelable: true, button: 0 });
              element.dispatchEvent(ev);
            } catch {
              /* ignore */
            }
          }
        };

  const ensureFocused =
    typeof u.ensureFocused === 'function'
      ? u.ensureFocused.bind(u)
      : async (element, attempts = 3) => {
          if (!element) return false;
          for (let i = 0; i < attempts; i += 1) {
            try {
              element.focus({ preventScroll: true });
            } catch {
              try {
                element.focus();
              } catch {
                /* ignore */
              }
            }
            await wait(40);
            if (document.activeElement === element) return true;
          }
          return document.activeElement === element;
        };

  const setContentEditableText =
    typeof u.setContentEditableText === 'function'
      ? u.setContentEditableText.bind(u)
      : (element, text) => {
          if (!element) throw new Error('setContentEditableText fallback: no element provided');
          const editableMode = String(element.getAttribute('contenteditable') || '').toLowerCase();
          if (editableMode === 'plaintext-only') {
            element.textContent = String(text ?? '');
            try {
              element.dispatchEvent(
                new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertText',
                  data: String(text),
                }),
              );
            } catch {
              element.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
            }
            try {
              element.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertText',
                  data: String(text),
                }),
              );
            } catch {
              element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
            element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            return;
          }
          while (element.firstChild) element.removeChild(element.firstChild);
          const lines = String(text).split('\n');
          for (const line of lines) {
            const p = document.createElement('p');
            p.textContent = line || '\u00A0';
            element.appendChild(p);
          }
          try {
            element.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: String(text),
              }),
            );
          } catch {
            element.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
          }
          try {
            element.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: String(text),
              }),
            );
          } catch {
            element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          }
          element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        };

  const setTextareaText =
    typeof u.setTextareaText === 'function'
      ? u.setTextareaText.bind(u)
      : (textarea, text) => {
          if (!(textarea instanceof HTMLTextAreaElement)) {
            throw new Error('setTextareaText fallback: expected textarea element');
          }
          textarea.value = String(text);
          try {
            textarea.dispatchEvent(
              new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: String(text),
              }),
            );
          } catch {
            textarea.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
          }
          try {
            textarea.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertFromPaste',
                data: String(text),
              }),
            );
          } catch {
            textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          }
          textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          try {
            const end = textarea.value.length;
            textarea.selectionStart = textarea.selectionEnd = end;
          } catch {
            /* ignore selection errors */
          }
        };

  const isDisabled =
    typeof u.isDisabled === 'function'
      ? u.isDisabled.bind(u)
      : (btn) => {
          if (!btn) return true;
          if (btn.disabled) return true;
          const aria = btn.getAttribute?.('aria-disabled');
          if (aria === 'true') return true;
          const style = window.getComputedStyle(btn);
          if (style.pointerEvents === 'none') return true;
          return false;
        };

  const findEnabledButton =
    typeof u.findEnabledButton === 'function'
      ? u.findEnabledButton.bind(u)
      : (selectors) => {
          const list = Array.isArray(selectors) ? selectors : String(selectors).split(',');
          for (const rawSel of list) {
            const sel = String(rawSel || '').trim();
            if (!sel) continue;
            const el = document.querySelector(sel);
            if (el && visible(el) && !isDisabled(/** @type {HTMLElement} */ (el))) {
              return /** @type {HTMLElement} */ (el);
            }
          }
          return null;
        };

  const ensureElementInteractable = async (element) => {
    if (!element) return;
    scrollIntoViewIfNeeded(element);
    try {
      element.focus({ preventScroll: true });
    } catch {
      try {
        element.focus();
      } catch {
        /* ignore */
      }
    }
    await wait(40);
  };

  const EDITOR_PRIMARY_SELECTORS = [
    '[data-lexical-editor="true"][contenteditable="true"]',
    '[data-lexical-editor="true"][contenteditable="plaintext-only"]',
    '[data-lexical-editor][contenteditable="true"]',
    '[data-lexical-editor][contenteditable="plaintext-only"]',
    '.ProseMirror[contenteditable="true"]',
    '.ProseMirror[contenteditable="plaintext-only"]',
    '[role="textbox"][contenteditable="true"]',
    '[role="textbox"][contenteditable="plaintext-only"]',
    '[data-testid*="composer"][contenteditable="true"]',
    '[data-testid*="composer"][contenteditable="plaintext-only"]',
    '[data-testid*="editor"][contenteditable="true"]',
    '[data-testid*="composer-rich-input"][contenteditable="true"]',
    '[data-testid*="composer-rich-input"][contenteditable="plaintext-only"]',
    '[contenteditable="true"][aria-multiline="true"]',
    '[contenteditable="plaintext-only"][aria-multiline="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="plaintext-only"][role="textbox"]',
  ];

  const EDITOR_FALLBACK_SELECTORS = [
    '.ProseMirror',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[contenteditable]:not([contenteditable="false"])',
    '[data-testid*="composer__editor"]',
    '[data-testid*="composer-rich-input"]',
    '[data-testid*="chat-composer__editor"]',
    '[data-testid*="chat-input"]',
    '[role="textbox"][data-lexical-editor="true"]',
  ];

  const EDITOR_TEXTAREA_SELECTORS = [
    'textarea[name="message"]',
    'textarea[data-testid*="composer"]',
    'textarea[data-testid*="chat-input"]',
    'textarea[data-testid*="artifacts"]',
    'textarea[aria-multiline="true"]',
    'textarea[aria-label*="Claude" i]',
    'textarea[aria-label*="Message" i]',
  ];

  const LEXICAL_TEXT_TEMPLATE = {
    type: 'text',
    version: 1,
    detail: 0,
    format: 0,
    mode: 'normal',
    style: '',
  };

  function findLexicalEditor(element) {
    if (!element) return null;
    const candidates = new Set();
    if (element && element.__lexicalEditor) {
      candidates.add(element.__lexicalEditor);
    }
    let current = element;
    while (current && current !== document.body) {
      if (current.__lexicalEditor) {
        candidates.add(current.__lexicalEditor);
        break;
      }
      current = current.parentElement;
    }
    if (typeof window !== 'undefined' && window.__lucidLexicalEditor) {
      candidates.add(window.__lucidLexicalEditor);
    }
    for (const editor of candidates) {
      if (editor && typeof editor.setEditorState === 'function') {
        return editor;
      }
    }
    return null;
  }

  function buildLexicalStateFromText(text) {
    const payloadText = String(text ?? '');
    const lines = payloadText.split(/\r?\n/);
    const children =
      lines.length === 0
        ? [
            {
              type: 'paragraph',
              version: 1,
              format: '',
              direction: null,
              indent: 0,
              textFormat: 0,
              children: [
                {
                  ...LEXICAL_TEXT_TEMPLATE,
                  text: '',
                },
              ],
            },
          ]
        : lines.map((line) => ({
            type: 'paragraph',
            version: 1,
            format: '',
            direction: null,
            indent: 0,
            textFormat: 0,
            children: [
              {
                ...LEXICAL_TEXT_TEMPLATE,
                text: line,
              },
            ],
          }));

    return {
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children,
      },
    };
  }

  async function applyLexicalEditorText(element, text) {
    const editor = findLexicalEditor(element);
    if (!editor) return false;
    try {
      const payload = buildLexicalStateFromText(text);
      const state =
        typeof editor.parseEditorState === 'function'
          ? editor.parseEditorState(payload)
          : payload;
      const result = editor.setEditorState(state);
      if (result && typeof result.then === 'function') {
        await result;
      }
      try {
        editor.focus?.();
      } catch {
        /* ignore */
      }
      const root = editor.getRootElement?.();
      await wait(80);
      if (root && root !== element) {
        return editorTextMatches(root, text) || editorTextMatches(element, text);
      }
      return editorTextMatches(element, text);
    } catch (error) {
      console.warn('Lexical text application failed', error);
      return false;
    }
  }

  const editorTracker = {
    /** @type {HTMLElement | null} */
    element: null,
    /** @type {MutationObserver | null} */
    observer: null,
  };

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
    /** @type {Set<HTMLElement>} */
    const seen = new Set();
    /** @type {{ el: HTMLElement, priority: number }[]} */
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
        push(/** @type {HTMLElement} */ (node), 0);
      }
    }
    for (const selector of EDITOR_FALLBACK_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        push(/** @type {HTMLElement} */ (node), 1);
      }
    }
    for (const selector of EDITOR_TEXTAREA_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (node instanceof HTMLTextAreaElement) {
          push(node, 2);
        }
      }
    }

    collected.sort((a, b) => a.priority - b.priority);
    return collected.map((entry) => entry.el);
  }

  function getTrackedEditor() {
    const current = editorTracker.element;
    if (current && current.isConnected && isEditableCandidate(current)) {
      return current;
    }
    return null;
  }

  function trackEditor(element) {
    if (!(element instanceof HTMLElement)) return;
    if (editorTracker.element === element) return;
    if (editorTracker.observer) {
      try {
        editorTracker.observer.disconnect();
      } catch {
        /* ignore */
      }
      editorTracker.observer = null;
    }
    editorTracker.element = element;

    try {
      const observer = new MutationObserver(() => {
        if (!element.isConnected || !isEditableCandidate(element)) {
          try {
            observer.disconnect();
          } catch {
            /* ignore */
          }
          editorTracker.observer = null;
          editorTracker.element = null;
        }
      });
      const parent = element.parentElement;
      if (parent) {
        observer.observe(parent, { childList: true, subtree: false });
      }
      observer.observe(element, { attributes: true, attributeFilter: ['contenteditable', 'aria-hidden'] });
      editorTracker.observer = observer;
    } catch {
      editorTracker.observer = null;
    }
  }

  function pickEditorCandidate() {
    const tracked = getTrackedEditor();
    if (tracked) return tracked;
    const candidates = collectEditorCandidates();
    return candidates.length > 0 ? candidates[0] : null;
  }

  async function ensureEditorReady(timeout = 20000, interval = 120) {
    try {
      const editor = await waitUntil(
        () => {
          const candidate = pickEditorCandidate();
          return candidate || null;
        },
        timeout,
        interval,
      );
      if (editor instanceof HTMLElement) {
        trackEditor(editor);
      }
      return /** @type {HTMLElement | null} */ (editor instanceof HTMLElement ? editor : null);
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
      try {
        element.focus();
      } catch {
        /* ignore */
      }
    }
    await wait(20);
    try {
      document.execCommand('selectAll', false);
    } catch {
      /* ignore */
    }
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

  async function tryClipboardPaste(element, text) {
    if (!(element instanceof HTMLElement)) return false;
    try {
      const data = new DataTransfer();
      data.setData('text/plain', String(text || ''));
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      const dispatched = element.dispatchEvent(event);
      await wait(60);
      return dispatched && editorTextMatches(element, text);
    } catch {
      return false;
    }
  }

  async function applyTextToEditor(element, text, warnings) {
    const value = String(text || '');
    if (element instanceof HTMLTextAreaElement) {
      try {
        setTextareaText(element, value);
      } catch (error) {
        throw new Error(`Unable to set Claude textarea text: ${String(error ?? 'unknown error')}`);
      }
      await wait(40);
      return;
    }

    const lexicalApplied = await applyLexicalEditorText(element, value);
    if (lexicalApplied && editorTextMatches(element, value)) {
      return;
    }

    try {
      setContentEditableText(element, value);
    } catch (error) {
      throw new Error(`Unable to set Claude message text: ${String(error ?? 'unknown error')}`);
    }

    await wait(60);
    if (editorTextMatches(element, value)) {
      return;
    }

    const execOk = await tryExecCommandInsert(element, value);
    if (execOk && editorTextMatches(element, value)) {
      try {
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      } catch {
        /* ignore */
      }
      return;
    }

    const pasteOk = await tryClipboardPaste(element, value);
    if (pasteOk && editorTextMatches(element, value)) {
      try {
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      } catch {
        /* ignore */
      }
      return;
    }

    warnings.push('Claude editor did not confirm text insertion via fallback mechanisms');
    if (!editorTextMatches(element, value)) {
      throw new Error('Claude editor did not accept text after fallbacks');
    }
  }

  async function triggerKeyboardSendFallback(editor) {
    const target =
      (editor && editor.isConnected ? editor : document.activeElement) ||
      document.body ||
      document.documentElement;
    if (!(target instanceof HTMLElement)) return false;

    const combos = [
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
      await wait(300);
      const candidate = findSendButtonCandidate({ requireEnabled: false });
      if (!candidate || isDisabled(candidate)) {
        return true;
      }
      if (editor && editorTextMatches(editor, '')) {
        return true;
      }
    }
    return false;
  }

  const TOOLS_MENU_BUTTON_SELECTORS = [
    'button[aria-label="Open tools menu"]',
    'button[aria-label*="tools" i]',
    'button[data-testid="tools-menu-trigger"]',
    'button[data-testid="quick-actions-trigger"]',
    'button[data-testid="quick-actions-menu-trigger"]',
    'button[data-testid="input-menu-tools"]',
    'button[aria-haspopup="menu"][aria-label*="quick actions" i]',
    'button[aria-haspopup="menu"][aria-label*="tools" i]',
  ];

  const RESEARCH_BUTTON_SELECTOR_HINTS = [
    'button[data-testid="research-toggle"]',
    '[data-testid="research-mode-toggle"]',
    '[role="menuitemcheckbox"][data-testid*="research"]',
    'button[data-testid="model-pill-research"]',
    '[data-testid="model-pill"][data-model*="research"]',
    'button[data-testid*="research-pill"]',
    'button[aria-label*="research" i]',
  ];

  const RESEARCH_ICON_SIGNATURES = ['10.3857 2.50977', '14.3486 2.71054'];

  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-testid="composer-send-button"]',
    'button[data-testid="chat-composer__send"]',
    'button[data-testid*="composer__send"]',
    'button[data-testid="artifacts-send-button"]',
    'div[data-testid="artifacts-send-button"]',
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[aria-label*="submit" i]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send"]',
    'div[data-testid="chat-composer__send-control"]',
    'div[role="button"][data-testid*="send-control"]',
  ];

  const SEND_BUTTON_ICON_SIGNATURES = [
    'lucide-arrow-up',
    'arrow-up',
    'paper-plane',
    'icon-send',
    '⌘⏎',
    'ctrl+enter',
  ];

  // ---------------------------------------------------------------------------
  // Helper functions for Research and Incognito modes
  // ---------------------------------------------------------------------------
  async function findToolsMenuButton(timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const direct = /** @type {HTMLButtonElement | null} */ (findEnabledButton(
        TOOLS_MENU_BUTTON_SELECTORS,
      ));
      if (direct) return direct;

      const fallback = /** @type {HTMLButtonElement | null} */ (
        Array.from(document.querySelectorAll('button')).find((btn) => {
          if (!(btn instanceof HTMLButtonElement)) return false;
          if (!visible(btn)) return false;
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const text = (btn.textContent || '').toLowerCase();
          if (aria.includes('tools') || aria.includes('quick actions')) return true;
          if (text.includes('tools') || text.includes('quick actions')) return true;
          return false;
        }) || null
      );
      if (fallback) return fallback;

      await wait(150);
    }
    return null;
  }

  function getSwitchElement(button) {
    if (!button) return null;
    const selectorCandidates = [
      'input[role="switch"]',
      'input[type="checkbox"]',
      '[data-testid="switch-thumb"]',
      '[role="switch"]',
    ];
    for (const sel of selectorCandidates) {
      const el = button.querySelector(sel);
      if (el) return /** @type {HTMLElement} */ (el);
    }
    return null;
  }

  function findResearchToggleButton() {
    for (const sel of RESEARCH_BUTTON_SELECTOR_HINTS) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement && visible(el)) return el;
    }
    const roots = [document];
    const portals = Array.from(document.querySelectorAll('[data-radix-portal]'));
    for (const portal of portals) {
      if (portal instanceof HTMLElement) roots.push(portal);
    }
    const selector = 'button, [role="menuitem"], [role="menuitemcheckbox"]';
    for (const root of roots) {
      const candidates = Array.from(root.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement)) continue;
        if (!visible(candidate)) continue;
        const text = (candidate.textContent || '').toLowerCase();
        const aria = (candidate.getAttribute('aria-label') || '').toLowerCase();
        const testId = (candidate.getAttribute('data-testid') || '').toLowerCase();
        if (
          text.includes('research') ||
          aria.includes('research') ||
          testId.includes('research')
        ) {
          return candidate;
        }
      }
    }

    const composerButtons = Array.from(document.querySelectorAll('fieldset button'));
    for (const candidate of composerButtons) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (!visible(candidate)) continue;
      if (candidate.getAttribute('aria-disabled') === 'true') continue;
      if (candidate instanceof HTMLButtonElement && candidate.disabled) continue;
      const aria = (candidate.getAttribute('aria-label') || '').toLowerCase();
      const text = (candidate.textContent || '').toLowerCase();
      if (aria.includes('research') || text.includes('research')) {
        return candidate;
      }
      const iconPath = candidate.querySelector('svg path')?.getAttribute('d') || '';
      if (iconPath && RESEARCH_ICON_SIGNATURES.some((sig) => iconPath.includes(sig))) {
        return candidate;
      }
    }
    return null;
  }

  function findResearchModelPill() {
    const selectors = [
      'button[data-testid="model-pill-research"]',
      'button[data-testid="model-pill"][data-model*="research" i]',
      'button[data-testid*="research-pill"]',
      'button[data-model*="research" i]',
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (!visible(candidate)) continue;
      const aria = (candidate.getAttribute('aria-label') || '').toLowerCase();
      const text = (candidate.textContent || '').toLowerCase();
      if (aria.includes('research') || text.includes('research')) {
        return candidate;
      }
    }
    return null;
  }

  function isResearchPillActive(button) {
    if (!(button instanceof HTMLElement)) return false;
    const dataState = (button.getAttribute('data-state') || button.dataset?.state || '').toLowerCase();
    if (['on', 'active', 'true', 'checked', 'selected'].includes(dataState)) return true;
    const ariaPressed = button.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    const ariaChecked = button.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    return false;
  }

  function isResearchActive() {
    const pill = findResearchModelPill();
    if (pill && isResearchPillActive(pill)) return true;
    const toggle = findResearchToggleButton();
    if (toggle && isResearchToggleActive(toggle)) return true;
    return false;
  }

  function isResearchToggleActive(button) {
    if (!button) return false;
    const switchEl = getSwitchElement(button);
    if (switchEl) {
      const anyChecked =
        (switchEl instanceof HTMLInputElement && (switchEl.checked || switchEl.indeterminate)) ||
        switchEl.getAttribute('aria-checked') === 'true' ||
        switchEl.getAttribute('data-state') === 'on';
      if (anyChecked) return true;
    }
    const ariaPressed = button.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    const dataState = (button.getAttribute('data-state') || '').toLowerCase();
    if (dataState === 'on' || dataState === 'true' || dataState === 'checked' || dataState === 'active') {
      return true;
    }
    const ariaChecked = button.getAttribute('aria-checked');
    return ariaChecked === 'true';
  }

  async function closeToolsMenu(triggerButton) {
    try {
      document.body?.click();
    } catch {
      /* ignore */
    }
    await wait(80);
    if (triggerButton && triggerButton.getAttribute('aria-expanded') === 'true') {
      try {
        triggerButton.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
        );
        triggerButton.dispatchEvent(
          new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }),
        );
      } catch {
        /* ignore */
      }
      await wait(80);
    }
  }

  async function verifyResearchEnabled(triggerButton) {
    if (isResearchActive()) {
      return true;
    }
    const button = triggerButton || (await findToolsMenuButton(4000));
    if (!button) return false;
    const wasExpanded = button.getAttribute('aria-expanded') === 'true';
    if (!wasExpanded) {
      simulateButtonClick(button);
      await wait(150);
    }
    const researchButton = await waitUntil(
      () => {
        const candidate = findResearchToggleButton();
        return candidate && visible(candidate) ? candidate : null;
      },
      3000,
      120,
    ).catch(() => null);
    const active =
      isResearchToggleActive(/** @type {HTMLElement | null} */ (researchButton)) || isResearchActive();
    if (!wasExpanded) {
      await closeToolsMenu(button);
    }
    return active;
  }

  async function triggerResearchShortcutFallback() {
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return false;
    const combos = [
      { key: 'R', code: 'KeyR', metaKey: true, shiftKey: true },
      { key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true },
    ];
    for (const combo of combos) {
      try {
        target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...combo }));
        target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, ...combo }));
      } catch {
        /* ignore */
      }
      await wait(320);
      if (await verifyResearchEnabled()) {
        return true;
      }
    }
    return false;
  }

  async function activateResearchPill(warnings) {
    const pill = findResearchModelPill();
    if (!(pill instanceof HTMLElement)) {
      return { attempted: false, success: false };
    }

    if (isResearchPillActive(pill)) {
      return { attempted: true, success: true, alreadyEnabled: true, method: 'pill' };
    }

    await ensureElementInteractable(pill);
    simulateButtonClick(pill);

    const activated = await waitUntil(() => isResearchPillActive(pill), 2500, 120).catch(() => false);
    if (activated) {
      return { attempted: true, success: true, method: 'pill' };
    }

    warnings.push('Research pill click did not confirm activation');
    return { attempted: true, success: false, method: 'pill' };
  }

  async function enableResearchMode() {
    try {
      console.log('Attempting to enable Research mode on Claude...');
      const warnings = [];

      const pillOutcome = await activateResearchPill(warnings);
      if (pillOutcome.attempted) {
        if (pillOutcome.success) {
          console.log('✅ Research mode enabled via model pill');
          return { success: true, method: pillOutcome.method || 'pill', alreadyEnabled: pillOutcome.alreadyEnabled, warnings };
        }
        warnings.push('Research pill activation fallback to tools menu');
      }

      const toolsMenuButton = await findToolsMenuButton(15000);

      if (!toolsMenuButton) {
        warnings.push('Research tools menu not found; attempted keyboard shortcut fallback');
        console.warn('Tools menu button not found; trying Research shortcut fallback');
        const shortcutSuccess = await triggerResearchShortcutFallback();
        return {
          success: shortcutSuccess,
          method: shortcutSuccess ? 'shortcut' : 'unavailable',
          warnings,
        };
      }

      if (toolsMenuButton.getAttribute('aria-expanded') !== 'true') {
        simulateButtonClick(toolsMenuButton);
        await wait(200);
      }

      const researchButton = await waitUntil(
        () => {
          const candidate = findResearchToggleButton();
          return candidate && visible(candidate) ? candidate : null;
        },
        5000,
        120,
      ).catch(() => null);

      if (!researchButton) {
        warnings.push('Research toggle not found in tools menu');
        await closeToolsMenu(toolsMenuButton);
        console.warn('Research toggle not found in tools menu; trying shortcut fallback');
        const shortcutSuccess = await triggerResearchShortcutFallback();
        return {
          success: shortcutSuccess,
          method: shortcutSuccess ? 'shortcut' : 'unavailable',
          warnings,
        };
      }

      if (isResearchToggleActive(researchButton)) {
        await closeToolsMenu(toolsMenuButton);
        console.log('✅ Research mode already enabled');
        return { success: true, alreadyEnabled: true, method: 'menu', warnings };
      }

      simulateButtonClick(researchButton);

      const activated = await waitUntil(
        () => isResearchToggleActive(researchButton),
        2500,
        120,
      ).catch(() => false);

      await closeToolsMenu(toolsMenuButton);

      if (activated) {
        console.log('✅ Research mode enabled via menu');
        return { success: true, method: 'menu', warnings };
      }

      console.warn('Research toggle click did not confirm activation; trying shortcut fallback');
      const shortcutSuccess = await triggerResearchShortcutFallback();
      if (shortcutSuccess) {
        warnings.push('Research enabled via keyboard shortcut fallback');
        return {
          success: true,
          method: 'shortcut',
          warnings,
        };
      }

      warnings.push('Unable to confirm Research activation');
      return {
        success: false,
        method: 'unavailable',
        warnings,
      };
    } catch (error) {
      console.error(`Error enabling Research mode: ${error}`);
      const warnings = [`Research mode error: ${String(error ?? 'unknown error')}`];
      return {
        success: false,
        method: 'error',
        warnings,
      };
    }
  }

  const INCOGNITO_ICON_SIGNATURES = ['look-around', '6.99951 8.66672', '10 2C 14.326', 'ghost'];
  const INCOGNITO_BUTTON_SELECTORS = [
    '[data-testid="incognito-mode-toggle"]',
    '[data-testid="composer-incognito-toggle"]',
    '[data-testid="composer-mode-incognito"]',
    'button[aria-label*="incognito" i]',
    'button[aria-label*="anonymous" i]',
    'button[aria-label*="temporary" i]',
    'div[role="button"][data-testid*="incognito"]',
  ];

  function isIncognitoActive() {
    try {
      if (typeof window !== 'undefined') {
        const href = String(window.location.href || '');
        if (href.includes('/incognito') || href.includes('?incognito')) {
          return true;
        }
      }

      const bodyIncognito = (document.body?.dataset?.incognito || '').toLowerCase();
      if (bodyIncognito === 'active' || bodyIncognito === 'true') {
        return true;
      }

      const indicatorSelectors = [
        '[data-testid="incognito-mode-indicator"]',
        '[aria-label*="incognito" i][data-state="active"]',
        'button[data-testid="incognito-mode-toggle"][aria-pressed="true"]',
        'button[aria-label*="incognito" i][aria-pressed="true"]',
        '[data-testid*="incognito"][data-state="active"]',
        '[data-testid="composer-mode-incognito"][data-state="active"]',
      ];
      if (indicatorSelectors.some((sel) => document.querySelector(sel))) {
        return true;
      }

      const incognitoPill = document.querySelector('[data-testid="composer-mode-incognito"]');
      if (
        incognitoPill instanceof HTMLElement &&
        (incognitoPill.getAttribute('aria-pressed') === 'true' ||
          incognitoPill.getAttribute('aria-checked') === 'true')
      ) {
        return true;
      }

      const bodyText = (document.body?.innerText || document.body?.textContent || '').toLowerCase();
      return bodyText.includes("you're incognito") || bodyText.includes('incognito chat');
    } catch {
      return false;
    }
  }

  function isLikelyIncognitoButton(button) {
    if (!(button instanceof HTMLElement)) return false;
    if (!visible(button)) return false;
    if (isDisabled(button)) return false;
    if (INCOGNITO_BUTTON_SELECTORS.some((sel) => button.matches(sel))) return true;

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
   * @returns {HTMLElement | null}
   */
  function findIncognitoButton() {
    for (const sel of INCOGNITO_BUTTON_SELECTORS) {
      const direct = document.querySelector(sel);
      if (direct instanceof HTMLElement && visible(direct) && !isDisabled(direct)) {
        return direct;
      }
      if (direct instanceof HTMLElement) {
        const closest = direct.closest('button');
        if (closest instanceof HTMLElement && visible(closest) && !isDisabled(closest)) {
          return closest;
        }
      }
    }

    const headerCandidates = Array.from(
      document.querySelectorAll('[class*="top"][class*="right"], header, [data-testid="top-bar"]'),
    ).flatMap((container) => Array.from(container.querySelectorAll('button, [role="button"]')));

    const allButtons = new Set(
      headerCandidates.concat(Array.from(document.querySelectorAll('button, [role="button"]'))),
    );
    for (const btn of allButtons) {
      if (!(btn instanceof HTMLElement)) continue;
      if (isLikelyIncognitoButton(btn)) {
        return btn;
      }
    }
    return null;
  }

  /**
   * @param {number} [timeout]
   * @param {number} [interval]
   * @returns {Promise<HTMLElement | null>}
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

  async function enableIncognitoMode({ maxAttempts = 2, buttonTimeout = 6000 } = {}) {
    const warnings = [];
    try {
      if (isIncognitoActive()) {
        console.log('✅ Incognito mode already active');
        return { success: true, alreadyEnabled: true, warnings };
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        console.log(`Attempt ${attempt}/${maxAttempts} to enable Incognito mode...`);

        const button = await waitForIncognitoButton(buttonTimeout);
        if (!(button instanceof HTMLElement)) {
          warnings.push(`Incognito button not found (attempt ${attempt})`);
          console.log('Incognito button not found within timeout');
          continue;
        }

        await ensureElementInteractable(button);

        simulateButtonClick(button);

        const activated = await verifyIncognitoEnabled(8000);
        if (activated) {
          console.log('✅ Incognito mode successfully activated on Claude');
          await wait(400); // allow UI to settle
          await ensureEditorReady(12000).catch(() => null);
          return { success: true, warnings };
        }

        warnings.push(`Incognito verification failed after click attempt ${attempt}`);
        console.log('Incognito verification failed after click, retrying after short delay...');
        await wait(800);
      }

      console.warn('Unable to confirm Incognito activation after retries');
      warnings.push('Incognito activation could not be confirmed');
      return { success: false, warnings };
    } catch (error) {
      console.error(`Error enabling Incognito mode: ${error}`);
      return {
        success: false,
        warnings: [`Incognito mode error: ${String(error ?? 'unknown error')}`],
      };
    }
  }

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
      const found = Array.from(document.querySelectorAll(sel));
      for (const node of found) {
        if (!(node instanceof HTMLElement)) continue;
        push(node);
        const button = node.closest('button');
        if (button instanceof HTMLElement) push(button);
      }
    }

    const iconSelectors = [
      'button svg.lucide-arrow-up',
      'button svg[data-icon="ArrowUp"]',
      'button svg[data-testid*="send"]',
      '[role="button"] svg[data-testid*="send"]',
      'svg[data-testid="icon-send"]',
    ];
    for (const sel of iconSelectors) {
      const icons = Array.from(document.querySelectorAll(sel));
      for (const icon of icons) {
        if (!(icon instanceof HTMLElement)) continue;
        const button = icon.closest('button, [role="button"]');
        if (button instanceof HTMLElement) push(button);
      }
    }

    const fallbackButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
    for (const btn of fallbackButtons) {
      if (!(btn instanceof HTMLElement)) continue;
      const text = (btn.textContent || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const html = btn.innerHTML || '';
      if (
        text.includes('send') ||
        aria.includes('send') ||
        SEND_BUTTON_ICON_SIGNATURES.some((sig) => html.toLowerCase().includes(sig))
      ) {
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
      const button = await waitUntil(
        () => {
          const candidate = findSendButtonCandidate();
          if (candidate && !isDisabled(candidate)) {
            return candidate;
          }
          return null;
        },
        timeout,
        interval,
      );
      return /** @type {HTMLElement | null} */ (button || null);
    } catch {
      return null;
    }
  }

  async function composeAndSendMessage(promptText, warnings) {
    const editor = await ensureEditorReady(25000);
    if (!editor) {
      throw new Error('Claude editor element not found');
    }

    const focused = await ensureFocused(editor, 5);
    if (!focused) {
      warnings.push('Unable to confirm focus on Claude editor before setting text');
    }

    try {
      await applyTextToEditor(editor, String(promptText || ''), warnings);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Unable to set Claude message text: ${String(error ?? 'unknown error')}`);
    }

    try {
      editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } catch {
      /* ignore */
    }

    try {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    } catch {
      /* ignore */
    }

    await wait(160);

    const sendButton = await waitForSendButtonEnabled(14000);
    if (!sendButton) {
      const fallback = findSendButtonCandidate({ requireEnabled: false });
      if (fallback) {
        warnings.push('Claude send control remained disabled after waiting; attempting keyboard fallback');
      } else {
        warnings.push('Claude send control not found');
      }
      const keyboardSuccess = await triggerKeyboardSendFallback(editor);
      if (!keyboardSuccess) {
        throw new Error('Claude send control not available');
      }
      return;
    }

    await ensureElementInteractable(sendButton);
    simulateButtonClick(sendButton);
    await wait(200);
  }

  // ---------------------------------------------------------------------------
  // Ported logic: automateClaudeInteraction (submit)
  // ---------------------------------------------------------------------------
  async function automateClaudeInteraction(promptText, enableResearchStr, enableIncognitoStr) {
    const enableResearch = enableResearchStr === 'Yes';
    const enableIncognito = enableIncognitoStr === 'Yes';
    const warnings = [];

    console.log(
      'Starting Claude automation' +
        (enableResearch ? ' with Research enabled' : '') +
        (enableIncognito ? ' with Incognito enabled' : ''),
    );

    if (
      document.querySelector('input[type="email"]') ||
      document.querySelector('form[action*="login"]') ||
      /log in|sign up/i.test(document.title || '')
    ) {
      throw new Error('Login page detected. Please log in to Claude first.');
    }

    if (!(await ensureEditorReady(20000))) {
      throw new Error('Claude editor element not found');
    }

    if (enableIncognito) {
      const incognitoResult = await enableIncognitoMode();
      if (incognitoResult.warnings) warnings.push(...incognitoResult.warnings);
      if (!incognitoResult.success) {
        warnings.push('Incognito mode could not be confirmed; continuing without it');
      }
      await ensureEditorReady(15000).catch(() => null);
    }

    if (enableResearch) {
      const researchResult = await enableResearchMode();
      if (researchResult.warnings) warnings.push(...researchResult.warnings);
      if (!researchResult.success) {
        warnings.push('Research mode could not be confirmed; continuing without it');
      }
      await ensureEditorReady(15000).catch(() => null);
    }

    await composeAndSendMessage(promptText, warnings);

    return { ok: true, warnings };
  }

  // ---------------------------------------------------------------------------
  // Ported logic: claudeFollowUpMessage (follow-up)
  // ---------------------------------------------------------------------------
  async function claudeFollowUpMessage(promptText) {
    const warnings = [];
    try {
      await composeAndSendMessage(promptText, warnings);
      return { ok: true, warnings };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error ?? 'unknown error'));
      err.message = `Claude follow-up failed: ${err.message}`;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Injector registration
  // ---------------------------------------------------------------------------
  ns.injectors.CLAUDE = {
    submit: async ({ prompt, options }) => {
      const research = options?.research ? 'Yes' : 'No';
      const incognito = options?.incognito ? 'Yes' : 'No';
      return automateClaudeInteraction(String(prompt || ''), research, incognito);
    },
    followup: async ({ prompt }) => {
      return claudeFollowUpMessage(String(prompt || ''));
    },
  };

  try {
    console.debug('LLM Burst Claude injector loaded');
  } catch {}
})();
