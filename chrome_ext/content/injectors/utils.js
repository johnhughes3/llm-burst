/**
 * LLM Burst - Content Utilities
 * Shared helpers for provider injectors (ChatGPT, Claude, Gemini, Grok).
 *
 * Exposed API:
 *   window.llmBurst.utils = {
 *     wait, waitUntil,
 *     visible, isInViewport, scrollIntoViewIfNeeded,
 *     simulateButtonClick, simulateFocusSequence,
 *     setContentEditableText, setTextareaText,
 *     ensureFocused,
 *     findFirst, elementReady,
 *     isDisabled, findEnabledButton
 *   }
 */
(function() {
  'use strict';

  const ns = (window.llmBurst = window.llmBurst || {});
  const utils = {};

  // ---------------------------------------------------------------------------
  // Timing helpers
  // ---------------------------------------------------------------------------

  /**
   * Sleep for ms milliseconds.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  utils.wait = function wait(ms) {
    const n = Number(ms);
    return new Promise((resolve) => setTimeout(resolve, Number.isFinite(n) && n > 0 ? n : 0));
  };

  /**
   * Poll until condition() returns a truthy value or timeout is reached.
   * Resolves with the truthy value, rejects on timeout.
   * @param {() => any} condition
   * @param {number} timeout default 3000 ms
   * @param {number} interval default 100 ms
   * @returns {Promise<any>}
   */
  utils.waitUntil = function waitUntil(condition, timeout = 3000, interval = 100) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        let result = null;
        try {
          result = condition();
        } catch {
          // ignore condition errors during polling
        }
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
  };

  // ---------------------------------------------------------------------------
  // Visibility / geometry helpers
  // ---------------------------------------------------------------------------

  /**
   * Whether an element is visible (displayed, visible, non-zero size).
   * @param {Element} el
   * @returns {boolean}
   */
  utils.visible = function visible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity) && opacity === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  /**
   * Whether an element is inside the viewport (with margin).
   * @param {Element} el
   * @param {number} margin
   * @returns {boolean}
   */
  utils.isInViewport = function isInViewport(el, margin = 4) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth || document.documentElement.clientWidth || 0;
    const h = window.innerHeight || document.documentElement.clientHeight || 0;
    return rect.bottom >= -margin &&
           rect.right  >= -margin &&
           rect.top    <= h + margin &&
           rect.left   <= w + margin;
  };

  /**
   * Scroll into view if needed (center viewport).
   * @param {Element} el
   */
  utils.scrollIntoViewIfNeeded = function scrollIntoViewIfNeeded(el) {
    try {
      if (!utils.isInViewport(el)) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      }
    } catch {
      // ignore
    }
  };

  // ---------------------------------------------------------------------------
  // Event simulation helpers
  // ---------------------------------------------------------------------------

  /**
   * Simulate a full pointer/mouse click sequence on an element.
   * @param {Element} element
   */
  utils.simulateButtonClick = function simulateButtonClick(element) {
    if (!element) return;
    utils.scrollIntoViewIfNeeded(element);

    const events = [
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      new MouseEvent('mousedown',   { bubbles: true, cancelable: true, button: 0 }),
      new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }),
      new MouseEvent('mouseup',     { bubbles: true, cancelable: true, button: 0 }),
      new MouseEvent('click',       { bubbles: true, cancelable: true, button: 0 })
    ];

    for (const ev of events) {
      try { element.dispatchEvent(ev); } catch { /* ignore */ }
    }
  };

  /**
   * Simulate a natural focus/click sequence for inputs/contenteditable.
   * @param {Element} element
   */
  utils.simulateFocusSequence = function simulateFocusSequence(element) {
    if (!element) return;
    utils.scrollIntoViewIfNeeded(element);

    const events = [
      new FocusEvent('focus',   { bubbles: true }),
      new FocusEvent('focusin', { bubbles: true }),
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      new MouseEvent('mousedown',     { bubbles: true, cancelable: true }),
      new PointerEvent('pointerup',   { bubbles: true, cancelable: true }),
      new MouseEvent('mouseup',       { bubbles: true, cancelable: true }),
      new MouseEvent('click',         { bubbles: true, cancelable: true })
    ];

    for (const ev of events) {
      try { element.dispatchEvent(ev); } catch { /* ignore */ }
    }
    try {
      element.focus({ preventScroll: true });
    } catch {
      try { element.focus(); } catch { /* ignore */ }
    }
  };

  // ---------------------------------------------------------------------------
  // Text input helpers
  // ---------------------------------------------------------------------------

  /**
   * Set text to a contenteditable element using paragraph nodes and dispatch input/change.
   * @param {HTMLElement} element
   * @param {string} text
   */
  utils.setContentEditableText = function setContentEditableText(element, text) {
    if (!element) throw new Error('setContentEditableText: no element provided');
    // Clear existing content
    while (element.firstChild) element.removeChild(element.firstChild);

    const lines = String(text).split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u00A0'; // non-breaking space for empty lines
      element.appendChild(p);
    }

    // Dispatch events expected by React/ProseMirror-like editors
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: String(text)
      }));
    } catch {
      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  };

  /**
   * Set text in a textarea and dispatch proper events React listens to.
   * @param {HTMLTextAreaElement} textarea
   * @param {string} text
   */
  utils.setTextareaText = function setTextareaText(textarea, text) {
    if (!textarea) throw new Error('setTextareaText: no textarea provided');
    textarea.value = String(text);

    try {
      textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
        data: String(text)
      }));
    } catch {
      textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    textarea.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

    // Move caret to end
    try {
      const end = textarea.value.length;
      textarea.selectionStart = textarea.selectionEnd = end;
    } catch {
      // ignore selection errors
    }
  };

  /**
   * Ensure an element has focus, attempting a few times with delays.
   * @param {Element} element
   * @param {number} attempts
   * @returns {Promise<boolean>}
   */
  utils.ensureFocused = async function ensureFocused(element, attempts = 3) {
    for (let i = 0; i < attempts; i += 1) {
      if (document.activeElement === element) return true;
      utils.simulateFocusSequence(element);
      await utils.wait(50);
      if (document.activeElement === element) return true;
    }
    return document.activeElement === element;
  };

  // ---------------------------------------------------------------------------
  // DOM finders
  // ---------------------------------------------------------------------------

  /**
   * Find the first element that matches any selector, optionally requiring visibility.
   * @param {string|string[]} selectors
   * @param {{root?: ParentNode, visibleOnly?: boolean}} opts
   * @returns {Element|null}
   */
  utils.findFirst = function findFirst(selectors, { root = document, visibleOnly = true } = {}) {
    const list = Array.isArray(selectors) ? selectors : String(selectors).split(',');
    for (const raw of list) {
      const sel = String(raw || '').trim();
      if (!sel) continue;
      const el = root.querySelector(sel);
      if (el && (!visibleOnly || utils.visible(el))) return el;
    }
    return null;
  };

  /**
   * Wait for the first element that matches any selector (and is visible if requested).
   * @param {string|string[]} selectors
   * @param {{timeout?: number, root?: ParentNode, visibleOnly?: boolean, interval?: number}} opts
   * @returns {Promise<Element>}
   */
  utils.elementReady = function elementReady(
    selectors,
    { timeout = 5000, root = document, visibleOnly = true, interval = 100 } = {}
  ) {
    return utils.waitUntil(
      () => utils.findFirst(selectors, { root, visibleOnly }),
      timeout,
      interval
    );
  };

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  /**
   * Check if a button-like element is disabled or non-interactive.
   * @param {HTMLElement} btn
   * @returns {boolean}
   */
  utils.isDisabled = function isDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    const aria = btn.getAttribute('aria-disabled');
    if (aria === 'true') return true;
    const style = window.getComputedStyle(btn);
    if (style.pointerEvents === 'none') return true;
    return false;
  };

  /**
   * Find the first enabled and visible button from a list of selectors.
   * @param {string|string[]} candidates
   * @returns {HTMLElement|null}
   */
  utils.findEnabledButton = function findEnabledButton(candidates) {
    const arr = Array.isArray(candidates) ? candidates : String(candidates).split(',');
    for (const selRaw of arr) {
      const sel = String(selRaw || '').trim();
      if (!sel) continue;
      const el = document.querySelector(sel);
      if (el && utils.visible(el) && !utils.isDisabled(el)) {
        return /** @type {HTMLElement} */ (el);
      }
    }
    return null;
  };

  // Expose namespace
  ns.utils = utils;

  try { console.debug('LLM Burst content utils loaded'); } catch {}
})();