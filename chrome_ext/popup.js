(function() {
  'use strict';

  const els = {};
  const state = {
    titleDirty: false,
    sending: false,
    currentAutonameRequestId: 0,
    draftTimer: null,
    lastDraftText: '',
    isComposing: false,
    charCount: 0,
    isNewSession: true,
    sendOnEnter: false
  };
  
  // Store cleanup functions for event listeners
  const cleanupFunctions = [];

  // Utility: wait
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Utility: send message to background with safe error handling
  async function sendMessage(type, params = {}) {
    try {
      const response = await chrome.runtime.sendMessage({ type, ...params });
      return response;
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // Status helpers
  function setStatus(text, kind = 'info') {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.style.display = text ? 'block' : 'none';
    els.status.classList.remove('status-message--error', 'status-message--success');
    if (kind === 'error') els.status.classList.add('status-message--error');
    if (kind === 'success') els.status.classList.add('status-message--success');
  }

  function clearStatus() { 
    setStatus('', 'info'); 
  }

  // Inline notice in the prompt footer (same area as Draft saved)
  function showInlineNotice(text) {
    if (!els.draftStatus) return;
    els.draftStatus.textContent = text;
    els.draftStatus.style.display = 'inline-block';
    els.draftStatus.classList.add('animate-fade');
    setTimeout(() => {
      if (!els?.draftStatus) return;
      els.draftStatus.style.display = 'none';
      els.draftStatus.classList.remove('animate-fade');
    }, 2000);
  }

  function setLoading(isLoading) {
    state.sending = isLoading;
    if (els.sendButton) {
      els.sendButton.disabled = isLoading;
    }
  }

  function setSpinnerVisible(visible) {
    if (els.autonameSpinner) {
      els.autonameSpinner.hidden = !visible;
    }
    if (els.autonameIcon) {
      els.autonameIcon.style.display = visible ? 'none' : '';
    }
  }

  // Draft management functions
  async function saveDraft(text) {
    if (!text || !text.trim()) {
      await clearDraft();
      return;
    }
    
    // Limit draft size to 10KB
    if (text.length > 10240) {
      text = text.substring(0, 10240);
    }
    
    try {
      await chrome.storage.session.set({
        draft: {
          text,
          timestamp: Date.now(),
        }
      });
      
      // Show inline indicator
      showInlineNotice('Draft saved');
    } catch (e) {
      console.error('[llm-burst] Failed to save draft:', e);
    }
  }

  async function loadDraft() {
    try {
      const data = await chrome.storage.session.get(['draft']);
      if (data.draft && data.draft.text) {
        const age = Date.now() - (data.draft.timestamp || 0);
        if (age < 24 * 60 * 60 * 1000) {
          return data.draft.text;
        }
      }
    } catch (e) {
      console.error('[llm-burst] Failed to load draft:', e);
    }
    return null;
  }

  async function clearDraft() {
    try {
      await chrome.storage.session.remove(['draft']);
    } catch (e) {
      console.error('[llm-burst] Failed to clear draft:', e);
    }
  }

  function scheduleDraftSave() {
    if (state.draftTimer) {
      clearTimeout(state.draftTimer);
    }
    state.draftTimer = setTimeout(() => {
      const text = els.prompt.value;
      if (text !== state.lastDraftText) {
        state.lastDraftText = text;
        saveDraft(text);
      }
    }, 750);
  }

  function updateClearButton() {
    if (els.clearBtn) {
      els.clearBtn.style.display = els.prompt.value.trim() ? '' : 'none';
    }
  }

  function updateCharCount() {
    const count = els.prompt.value.length;
    state.charCount = count;
    
    if (els.charCount) {
      if (count > 1000) {
        els.charCount.textContent = `${count.toLocaleString()} / 10,000`;
        els.charCount.style.display = 'block';
      } else {
        els.charCount.style.display = 'none';
      }
    }
  }

  // Auto-expand textarea with performance optimization
  const autoExpandTextarea = (() => {
    let rafId = null;
    return function() {
      if (!els.prompt) return;
      if (rafId) cancelAnimationFrame(rafId);
      
      rafId = requestAnimationFrame(() => {
        els.prompt.style.height = 'auto';
        const newHeight = Math.min(els.prompt.scrollHeight, state.isNewSession ? 200 : 400);
        els.prompt.style.height = newHeight + 'px';
        rafId = null;
      });
    };
  })();

  async function handleClear() {
    els.prompt.value = '';
    els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
    await clearDraft();
    updateClearButton();
    updateCharCount();
    autoExpandTextarea();
    els.prompt.focus();
    showInlineNotice('Draft cleared');
  }

  // Clipboard prefill (best-effort)
  async function prefillFromClipboard() {
    try {
      const current = els.prompt.value.trim();
      if (current.length > 0) return;
      
      // First check for saved draft
      const draft = await loadDraft();
      if (draft) {
        els.prompt.value = draft;
        els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
        showInlineNotice('Draft restored');
        return;
      }
      
      // Try clipboard (often fails without user gesture)
      const text = await navigator.clipboard.readText();
      if (text && text.trim().length > 0) {
        els.prompt.value = text.trim();
        els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
        showInlineNotice('Pasted from clipboard');
      }
    } catch (e) {
      // Expected when popup opens without user gesture
      console.debug('[llm-burst] Clipboard prefill not available');
    }
  }
  
  // Load defaults from storage
  async function loadDefaults() {
    try {
      const data = await chrome.storage?.sync?.get?.(['settings']) || {};
      const settings = data.settings || {};
      
      // Wait for DOM elements to be ready
      await waitForProviderElements();
      
      if (typeof settings.defaultResearch === 'boolean' && els.research) {
        els.research.checked = settings.defaultResearch;
      }
      if (typeof settings.defaultIncognito === 'boolean' && els.incognito) {
        els.incognito.checked = settings.defaultIncognito;
      }
      // Enter-to-send preference (default false)
      state.sendOnEnter = !!settings.sendOnEnter;

      // Update visible hints based on preference
      updateSendShortcutHint();
      if (Array.isArray(settings.defaultProviders) && settings.defaultProviders.length > 0) {
        console.log('[llm-burst] Loading default providers:', settings.defaultProviders);
        setProviders(settings.defaultProviders);
        if (els.research?.checked) {
          deselectProvider('GROK');
        }
      } else {
        // No saved defaults: select all providers for a new conversation
        ensureDefaultProvidersForNewSession();
      }
    } catch (e) {
      console.error('[llm-burst] Failed to load defaults:', e);
    }
  }

  // Apply any pending options set by a keyboard command, then clear them.
  async function applyPendingPopupOptions() {
    try {
      const { pendingPopupOptions } = await chrome.storage.session.get(['pendingPopupOptions']);
      if (pendingPopupOptions && typeof pendingPopupOptions === 'object') {
        const { research, incognito } = pendingPopupOptions;
        if (typeof research === 'boolean' && els.research) {
          els.research.checked = research;
          els.research.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof incognito === 'boolean' && els.incognito) {
          els.incognito.checked = incognito;
          els.incognito.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      await chrome.storage.session.remove(['pendingPopupOptions']);
    } catch (e) {
      // Non-fatal
      console.warn('[llm-burst] Could not apply pending popup options:', e);
    }
  }

  function updateSendShortcutHint() {
    const hint = document.getElementById('promptHint');
    if (hint) {
      hint.textContent = state.sendOnEnter ? 'Enter to send (Shift+Enter for newline)' : '⌘/Ctrl+Enter to send';
    }
    const btnShortcut = document.querySelector('.send-button__shortcut');
    if (btnShortcut) {
      btnShortcut.textContent = state.sendOnEnter ? 'Enter' : '⌘+Enter';
    }
  }
  
  // Wait for provider elements to exist in DOM
  async function waitForProviderElements() {
    return new Promise(resolve => {
      // Check if elements already exist - try both old and new class names
      const selector = '.provider-card__checkbox, .provider-pill__checkbox';
      if (document.querySelector(selector)) {
        resolve();
        return;
      }
      
      // Otherwise wait for them to be created
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 5000);
    });
  }

  function getSelectedProviders() {
    const keys = [];
    // Check both old and new class names
    document.querySelectorAll('.provider-card__checkbox:checked, .provider-pill__checkbox:checked').forEach(cb => {
      const provider = cb.getAttribute('data-provider');
      if (provider) keys.push(provider);
    });
    return keys;
  }

  function setProviders(providerKeys) {
    const set = new Set(providerKeys || []);
    // Check both old and new class names
    document.querySelectorAll('.provider-card__checkbox, .provider-pill__checkbox').forEach(cb => {
      const provider = cb.getAttribute('data-provider');
      cb.checked = set.has(provider);
      
      // Handle both card and pill styles
      const card = cb.closest('.provider-card');
      if (card) {
        card.classList.toggle('provider-card--selected', cb.checked);
      }
      
      const pill = cb.closest('.provider-pill');
      if (pill) {
        pill.classList.toggle('provider-pill--selected', cb.checked);
      }
    });
  }

  function getAllProviderIds() {
    const ids = new Set();
    document.querySelectorAll('.provider-card__checkbox, .provider-pill__checkbox').forEach(cb => {
      const id = cb.getAttribute('data-provider');
      if (id) ids.add(id);
    });
    return Array.from(ids);
  }

  function deselectProvider(id) {
    const sel = `.provider-card__checkbox[data-provider="${id}"] , .provider-pill__checkbox[data-provider="${id}"]`;
    document.querySelectorAll(sel).forEach(cb => {
      cb.checked = false;
      const card = cb.closest('.provider-card');
      if (card) card.classList.remove('provider-card--selected');
      const pill = cb.closest('.provider-pill');
      if (pill) pill.classList.remove('provider-pill--selected');
    });
  }

  function ensureDefaultProvidersForNewSession() {
    const isNew = !els.sessionSelect || els.sessionSelect.value === '__new__';
    if (!isNew) return;
    const selected = getSelectedProviders();
    if (selected.length === 0) {
      setProviders(getAllProviderIds());
    }
    if (els.research?.checked) {
      deselectProvider('GROK');
    }
  }

  // Load sessions from storage
  async function loadSessions() {
    try {
      const result = await chrome.storage.local.get(['sessions', 'sessionOrder']);
      const sessions = result.sessions || {};
      const order = result.sessionOrder || Object.keys(sessions);
      
      if (els.sessionSelect) {
        // Clear ALL options except "New conversation"
        while (els.sessionSelect.options.length > 1) {
          els.sessionSelect.remove(1);
        }
        
        // Add sessions in order
        order.forEach(sessionId => {
          const session = sessions[sessionId];
          if (session) {
            const option = document.createElement('option');
            option.value = sessionId;
            option.textContent = session.title || `Session ${sessionId}`;
            els.sessionSelect.appendChild(option);
          }
        });
      }
      
      clearStatus();
    } catch (e) {
      console.error('[llm-burst] Failed to load sessions:', e);
      setStatus('Failed to load sessions', 'error');
    }
  }

  // Update UI state based on session selection
  function updateUIState() {
    const isNew = !els.sessionSelect || els.sessionSelect.value === '__new__';
    state.isNewSession = isNew;
    
    // Add/remove class on app container for layout adjustment
    const app = document.querySelector('.app');
    if (app) {
      app.classList.toggle('app--existing-conversation', !isNew);
    }
    
    // Update conditional sections
    const conditionalSections = ['providerSection', 'optionsSection', 'titleSection'];
    
    conditionalSections.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        if (isNew) {
          element.classList.remove('section--hidden');
          element.setAttribute('aria-hidden', 'false');
        } else {
          element.classList.add('section--hidden');
          element.setAttribute('aria-hidden', 'true');
        }
      }
    });
    
    // Update send button text
    const sendButtonText = document.getElementById('sendButtonText');
    if (sendButtonText) {
      sendButtonText.textContent = isNew ? 'Send' : 'Continue Thread';
    }
    
    // Adjust textarea
    if (els.prompt) {
      // Reduce default rows in popup to avoid vertical overflow
      els.prompt.rows = isNew ? 6 : 10;
      autoExpandTextarea();
    }
  }

  // Auto-generate title
  async function generateTitle() {
    const prompt = els.prompt.value.trim();
    if (!prompt || state.titleDirty) return;
    
    const requestId = ++state.currentAutonameRequestId;
    setSpinnerVisible(true);
    
    try {
      const result = await sendMessage('llmburst-autoname', { text: prompt });
      
      if (requestId !== state.currentAutonameRequestId) {
        setSpinnerVisible(false);
        return;
      }
      
      if (result.ok && result.title && !state.titleDirty) {
        els.groupTitle.value = result.title;
        els.groupTitle.classList.add('animate-slide-in');
      } else if (!result.ok) {
        console.error('[llm-burst] Title generation failed:', result.error);
      }
    } catch (e) {
      console.error('[llm-burst] Title generation error:', e);
    } finally {
      if (requestId === state.currentAutonameRequestId) {
        setSpinnerVisible(false);
      }
    }
  }

  // Send handler
  async function handleSend() {
    if (state.sending) return;
    
    const prompt = els.prompt.value.trim();
    if (!prompt) {
      setStatus('Please enter a prompt', 'error');
      els.prompt.focus();
      return;
    }
    
    const providers = getSelectedProviders();
    if (providers.length === 0) {
      setStatus('Please select at least one provider', 'error');
      return;
    }
    
    const sessionId = els.sessionSelect?.value;
    const isNew = !sessionId || sessionId === '__new__';
    
    // Auto-generate title if needed (for new sessions with no manual title)
    if (isNew && !state.titleDirty && !els.groupTitle?.value && prompt) {
      await generateTitle();
    }
    
    setLoading(true);
    
    let result;
    if (isNew) {
      const title = els.groupTitle?.value.trim() || 
                   `Session ${new Date().toLocaleTimeString()}`;
      
      result = await sendMessage('llmburst-start-new-session', {
        prompt,
        providers,
        title,
        options: {
          research: els.research?.checked || false,
          incognito: els.incognito?.checked || false
        }
      });
    } else {
      result = await sendMessage('llmburst-follow-up', {
        sessionId,
        prompt
      });
    }
    
    setLoading(false);
    
    if (result.ok) {
      setStatus('Sent successfully!', 'success');
      els.prompt.value = '';
      await clearDraft();
      updateClearButton();
      updateCharCount();
      autoExpandTextarea();
      
      // Reload sessions if new one was created
      if (isNew && result.sessionId) {
        await loadSessions();
        if (els.sessionSelect) {
          els.sessionSelect.value = result.sessionId;
          updateUIState();
        }
      }
      
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus(result.error || 'Failed to send', 'error');
    }
  }

  // Bind events
  function bindEvents() {
    // Session selector
    if (els.sessionSelect) {
      els.sessionSelect.addEventListener('change', updateUIState);
    }
    
    // Prompt textarea
    if (els.prompt) {
      els.prompt.addEventListener('input', () => {
        updateClearButton();
        updateCharCount();
        autoExpandTextarea();
        scheduleDraftSave();
        
        // Removed auto-naming on every keystroke - now only triggered by explicit actions
      });
      
      // Keyboard shortcut
      els.prompt.addEventListener('keydown', (e) => {
        if (state.isComposing) return;
        // Cmd/Ctrl+Enter always sends
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          handleSend();
        } else if (
          // Plain Enter sends when enabled; Shift+Enter always newline
          e.key === 'Enter' &&
          state.sendOnEnter &&
          !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey
        ) {
          e.preventDefault();
          handleSend();
        }
      });
      
      // IME composition
      els.prompt.addEventListener('compositionstart', () => {
        state.isComposing = true;
      });
      
      els.prompt.addEventListener('compositionend', () => {
        state.isComposing = false;
      });
      
      // Save draft on blur
      els.prompt.addEventListener('blur', () => {
        // Save draft
        if (state.draftTimer) {
          clearTimeout(state.draftTimer);
        }
        const text = els.prompt.value;
        if (text !== state.lastDraftText) {
          state.lastDraftText = text;
          saveDraft(text);
        }
        
        // Removed auto-generate title on blur - now only triggered by explicit actions
      });
    }
    
    // Title input
    if (els.groupTitle) {
      els.groupTitle.addEventListener('input', () => {
        state.titleDirty = els.groupTitle.value.length > 0;
      });
    }
    
    // Auto-name button
    if (els.autonameBtn) {
      els.autonameBtn.addEventListener('click', () => {
        state.titleDirty = false;
        generateTitle();
      });
    }
    
    // Send button
    if (els.sendButton) {
      els.sendButton.addEventListener('click', () => {
        handleSend();
      });
    }
    
    // Paste button
    if (els.pasteBtn) {
      els.pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().length > 0) {
            els.prompt.value = text.trim();
            els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
            els.prompt.focus();
            showInlineNotice('Pasted from clipboard');
            
            // Auto-generate title after paste only if Advanced Options is open and title is blank
            if (state.isNewSession && !state.titleDirty && text.trim() && 
                els.advancedOptions && els.advancedOptions.open && !els.groupTitle.value) {
              setTimeout(() => generateTitle(), 500);
            }
          } else {
            showInlineNotice('Clipboard is empty');
          }
        } catch (e) {
          setStatus('Failed to read clipboard', 'error');
          setTimeout(clearStatus, 2000);
        }
      });
    }

    // Research toggle: on enabling, deselect GROK once (user can reselect)
    if (els.research) {
      els.research.addEventListener('change', () => {
        if (els.research.checked) {
          deselectProvider('GROK');
        }
      });
    }

    // Clear button
    if (els.clearBtn) {
      els.clearBtn.addEventListener('click', handleClear);
    }
    
    // Settings button
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
      });
    }
    
    // Advanced options toggle - trigger title generation when opened
    if (els.advancedOptions) {
      els.advancedOptions.addEventListener('toggle', () => {
        if (els.advancedOptions.open && state.isNewSession && !state.titleDirty && 
            !els.groupTitle.value && els.prompt.value.trim()) {
          generateTitle();
        }
      });
    }
    
    // Save draft on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const text = els.prompt?.value;
        if (text && text !== state.lastDraftText) {
          state.lastDraftText = text;
          saveDraft(text);
        }
      }
    });
    
    // Keyboard shortcuts for research and incognito
    document.addEventListener('keydown', (e) => {
      // In‑popup shortcuts only: Cmd/Ctrl+Shift+E (Research), Cmd/Ctrl+Shift+I (Incognito)
      // These work even while typing; we prevent default to avoid unintended effects.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey) {
        const k = e.key;
        if (k === 'e' || k === 'E') {
          e.preventDefault();
          e.stopPropagation();
          if (els.research) {
            els.research.checked = !els.research.checked;
            els.research.dispatchEvent(new Event('change', { bubbles: true }));
            flashElement(els.research.closest('.toggle'));
          }
        } else if (k === 'i' || k === 'I') {
          e.preventDefault();
          e.stopPropagation();
          if (els.incognito) {
            els.incognito.checked = !els.incognito.checked;
            els.incognito.dispatchEvent(new Event('change', { bubbles: true }));
            flashElement(els.incognito.closest('.toggle'));
          }
        }
      }

      // Esc closes the popup/launcher
      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        window.close();
      }
    });
  }
  
  // Flash element for visual feedback
  function flashElement(element) {
    if (!element) return;
    element.style.transition = 'background-color 200ms';
    const originalBg = element.style.backgroundColor;
    element.style.backgroundColor = 'rgba(79, 140, 255, 0.3)';
    setTimeout(() => {
      element.style.backgroundColor = originalBg;
    }, 200);
  }

  // Capture element references
  function captureElements() {
    els.prompt = document.getElementById('prompt');
    els.pasteBtn = document.getElementById('pasteBtn');
    els.clearBtn = document.getElementById('clearBtn');
    els.research = document.getElementById('research');
    els.incognito = document.getElementById('incognito');
    els.sessionSelect = document.getElementById('sessionSelect');
    els.groupTitle = document.getElementById('groupTitle');
    els.autonameBtn = document.getElementById('autonameBtn');
    els.autonameSpinner = document.getElementById('autonameSpinner');
    els.autonameIcon = document.getElementById('autonameIcon');
    els.status = document.getElementById('status');
    els.sendButton = document.getElementById('sendButton');
    els.charCount = document.getElementById('charCount');
    els.draftStatus = document.getElementById('draftStatus');
    els.advancedOptions = document.getElementById('advancedOptions');
  }

  // Cleanup function to remove all event listeners
  function cleanup() {
    cleanupFunctions.forEach(fn => fn());
    cleanupFunctions.length = 0;
    
    if (state.draftTimer) {
      clearTimeout(state.draftTimer);
      state.draftTimer = null;
    }
  }
  
  // Initialize
  async function init() {
    // Wait for DOM to be ready
    await sleep(100);
    
    captureElements();
    bindEvents();
    updateUIState();
    
    // Load data
    await loadDefaults();
    await applyPendingPopupOptions();
    await loadSessions();
    
    // Try prefill from clipboard or draft
    await prefillFromClipboard();
    
    // Focus prompt
    if (els.prompt) {
      els.prompt.focus();
    }
  }
  
  // Cleanup on unload
  window.addEventListener('unload', cleanup);
  cleanupFunctions.push(() => window.removeEventListener('unload', cleanup));

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 50);
  }
})();
