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
    isNewSession: true
  };

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
      
      // Show draft saved indicator
      if (els.draftStatus) {
        els.draftStatus.style.display = 'block';
        els.draftStatus.classList.add('animate-fade');
        setTimeout(() => {
          if (els.draftStatus) {
            els.draftStatus.style.display = 'none';
            els.draftStatus.classList.remove('animate-fade');
          }
        }, 2000);
      }
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

  // Auto-expand textarea
  function autoExpandTextarea() {
    if (!els.prompt) return;
    
    requestAnimationFrame(() => {
      els.prompt.style.height = 'auto';
      const newHeight = Math.min(els.prompt.scrollHeight, state.isNewSession ? 200 : 400);
      els.prompt.style.height = newHeight + 'px';
    });
  }

  async function handleClear() {
    const text = els.prompt.value;
    if (text.length > 100) {
      if (!confirm('Clear draft? This cannot be undone.')) {
        return;
      }
    }
    els.prompt.value = '';
    els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
    await clearDraft();
    updateClearButton();
    updateCharCount();
    autoExpandTextarea();
    els.prompt.focus();
    setStatus('Draft cleared', 'info');
    setTimeout(clearStatus, 2000);
  }

  // Load defaults from storage
  async function loadDefaults() {
    try {
      const data = await chrome.storage?.sync?.get?.(['settings']) || {};
      const settings = data.settings || {};
      if (typeof settings.defaultResearch === 'boolean') {
        els.research.checked = settings.defaultResearch;
      }
      if (typeof settings.defaultIncognito === 'boolean') {
        els.incognito.checked = settings.defaultIncognito;
      }
      if (Array.isArray(settings.defaultProviders)) {
        setProviders(settings.defaultProviders);
      }
    } catch {
      // ignore errors
    }
  }

  function getSelectedProviders() {
    const keys = [];
    document.querySelectorAll('.provider-card__checkbox:checked').forEach(cb => {
      const provider = cb.getAttribute('data-provider');
      if (provider) keys.push(provider);
    });
    return keys;
  }

  function setProviders(providerKeys) {
    const set = new Set(providerKeys || []);
    document.querySelectorAll('.provider-card__checkbox').forEach(cb => {
      const provider = cb.getAttribute('data-provider');
      cb.checked = set.has(provider);
      const card = cb.closest('.provider-card');
      if (card) {
        card.classList.toggle('provider-card--selected', cb.checked);
      }
    });
  }

  // Load sessions from storage
  async function loadSessions() {
    try {
      const result = await chrome.storage.local.get('sessions');
      const sessions = result.sessions || [];
      
      if (sessions.length > 0 && els.sessionSelect) {
        sessions.forEach(session => {
          const option = document.createElement('option');
          option.value = session.id;
          option.textContent = session.title || `Session ${session.id}`;
          els.sessionSelect.appendChild(option);
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
      els.prompt.rows = isNew ? 8 : 12;
      autoExpandTextarea();
    }
  }

  // Auto-generate title
  async function generateTitle() {
    const prompt = els.prompt.value.trim();
    if (!prompt || state.titleDirty) return;
    
    const requestId = ++state.currentAutonameRequestId;
    setSpinnerVisible(true);
    
    const result = await sendMessage('llmburst-autoname', { prompt });
    
    if (requestId !== state.currentAutonameRequestId) return;
    
    setSpinnerVisible(false);
    
    if (result.ok && result.title && !state.titleDirty) {
      els.groupTitle.value = result.title;
      els.groupTitle.classList.add('animate-slide-in');
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
    
    setLoading(true);
    
    const sessionId = els.sessionSelect?.value;
    const isNew = !sessionId || sessionId === '__new__';
    
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
        
        // Auto-generate title on first input
        if (state.isNewSession && !state.titleDirty && els.prompt.value.length > 20) {
          generateTitle();
        }
      });
      
      // Keyboard shortcut
      els.prompt.addEventListener('keydown', (e) => {
        if (state.isComposing) return;
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
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
        if (state.draftTimer) {
          clearTimeout(state.draftTimer);
        }
        const text = els.prompt.value;
        if (text !== state.lastDraftText) {
          state.lastDraftText = text;
          saveDraft(text);
        }
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
      els.sendButton.addEventListener('click', handleSend);
    }
    
    // Paste button
    if (els.pasteBtn) {
      els.pasteBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text && text.trim().length > 0) {
            const currentText = els.prompt.value.trim();
            if (currentText && currentText !== text.trim()) {
              if (!confirm('Replace current text with clipboard content?')) {
                return;
              }
            }
            els.prompt.value = text.trim();
            els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
            els.prompt.focus();
            setStatus('Pasted from clipboard', 'success');
            setTimeout(clearStatus, 2000);
          } else {
            setStatus('Clipboard is empty', 'error');
            setTimeout(clearStatus, 2000);
          }
        } catch (e) {
          setStatus('Failed to read clipboard', 'error');
          setTimeout(clearStatus, 2000);
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
    await loadSessions();
    
    // Try to restore draft
    const draft = await loadDraft();
    if (draft && els.prompt) {
      els.prompt.value = draft;
      els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus('Draft restored', 'info');
      setTimeout(clearStatus, 2000);
    }
    
    // Focus prompt
    if (els.prompt) {
      els.prompt.focus();
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 50);
  }
})();