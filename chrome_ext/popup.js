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
    els.status.textContent = text || '';
    els.status.classList.remove('error', 'success', 'info');
    els.status.classList.add(kind);
  }

  function clearStatus() { setStatus('', 'info'); }

  function setLoading(isLoading) {
    state.sending = isLoading;
    els.sendButton.disabled = isLoading;
  }

  function setSpinnerVisible(visible) {
    els.autonameSpinner.hidden = !visible;
  }

  // Draft management functions
  async function saveDraft(text) {
    // Don't save empty drafts
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
    } catch (e) {
      console.error('[llm-burst] Failed to save draft:', e);
    }
  }

  async function loadDraft() {
    try {
      const data = await chrome.storage.session.get(['draft']);
      if (data.draft && data.draft.text) {
        // Check if draft is recent (within 24 hours)
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
    }, 750); // 750ms debounce
  }

  function updateClearButton() {
    if (els.clearBtn) {
      els.clearBtn.style.display = els.prompt.value.trim() ? '' : 'none';
    }
  }

  async function handleClear() {
    els.prompt.value = '';
    els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
    await clearDraft();
    updateClearButton();
    els.prompt.focus();
    setStatus('Draft cleared', 'info');
    setTimeout(clearStatus, 2000);
  }

  // Clipboard prefill (best-effort)
  async function prefillFromClipboard() {
    try {
      const current = els.prompt.value.trim();
      if (current.length > 0) return; // Don't override user input
      
      // Try to read clipboard - this often fails due to permission requirements
      // Chrome requires user gesture for clipboard access in extensions
      // First check for saved draft
      const draft = await loadDraft();
      if (draft) {
        els.prompt.value = draft;
        els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
        setStatus('Draft restored', 'info');
        setTimeout(clearStatus, 2000);
        return;
      }
      
      // Otherwise try clipboard
      const text = await navigator.clipboard.readText();
      if (text && text.trim().length > 0) {
        els.prompt.value = text.trim();
        // Trigger input handlers
        els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {
      // Clipboard read failed - this is expected when popup opens without user gesture
      // Users can still paste manually with Cmd+V
      console.debug('[llm-burst] Clipboard prefill not available (requires user gesture)');
    }
  }

  // Load defaults (if any) from storage.sync
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
      // ignore missing storage or errors
    }
  }

  function getSelectedProviders() {
    const keys = [];
    const checkboxes = [
      els.provChatGPT,
      els.provClaude,
      els.provGemini,
      els.provGrok
    ];
    for (const cb of checkboxes) {
      if (cb.checked) {
        const key = cb.getAttribute('data-provider');
        if (key) keys.push(key);
      }
    }
    return keys;
  }

  function setProviders(providerKeys) {
    const set = new Set(providerKeys || []);
    els.provChatGPT.checked = set.has('CHATGPT');
    els.provClaude.checked = set.has('CLAUDE');
    els.provGemini.checked = set.has('GEMINI');
    els.provGrok.checked = set.has('GROK');
  }

  function updateNewSessionVisibility() {
    const isNew = els.sessionSelect.value === '__new__';
    els.newSessionFields.style.display = isNew ? '' : 'none';
  }

  async function loadSessions() {
    try {
      const resp = await sendMessage('llmburst-get-sessions');
      if (!resp || !resp.ok) {
        // Background not yet updated; keep only "New conversation"
        return;
      }
      const { sessions = {}, order = [] } = resp;
      // Clear existing options (keep first)
      els.sessionSelect.innerHTML = '';
      const optNew = document.createElement('option');
      optNew.value = '__new__';
      optNew.textContent = 'New conversation';
      els.sessionSelect.appendChild(optNew);

      // Fill ordered sessions
      for (const id of order) {
        const sess = sessions[id];
        if (!sess) continue;
        const label = sess.title || `Session ${id}`;
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = label;
        els.sessionSelect.appendChild(opt);
      }

      updateNewSessionVisibility();
    } catch (e) {
      // ignore errors; UI remains usable for new session
    }
  }

  // Auto-naming: debounce calls; only apply when new session and title not edited
  let autoNameTimer = null;
  function scheduleAutoName() {
    if (els.sessionSelect.value !== '__new__') return;
    const text = els.prompt.value.trim();
    if (text.length < 4) return; // too short to name
    if (state.titleDirty) return;

    if (autoNameTimer) clearTimeout(autoNameTimer);
    autoNameTimer = setTimeout(() => requestAutoName(text), 450);
  }

  function sanitizeTitle(title) {
    if (!title) return '';
    // Remove quotes/newlines and trim length
    let t = String(title).replace(/[\r\n]+/g, ' ').replace(/^["'\s]+|["'\s]+$/g, '');
    if (t.length > 80) t = t.slice(0, 80).trim();
    return t;
  }

  async function requestAutoName(text) {
    const requestId = ++state.currentAutonameRequestId;
    setSpinnerVisible(true);
    try {
      const resp = await sendMessage('llmburst-autoname', { text, timeoutMs: 15000 });
      // Ignore out-of-date responses
      if (requestId !== state.currentAutonameRequestId) return;

      if (!state.titleDirty && els.sessionSelect.value === '__new__') {
        if (resp && resp.ok) {
          const title = sanitizeTitle(resp.title);
          if (title && !els.groupTitle.value) {
            els.groupTitle.value = title;
          }
        } else {
          // Fallback to timestamp format MMM-DD HH:MM when auto-naming fails
          if (!els.groupTitle.value) {
            const now = new Date();
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[now.getMonth()];
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            els.groupTitle.value = `${month}-${day} ${hours}:${minutes}`;
          }
        }
      }
    } finally {
      // Only hide spinner if this is the most recent request
      if (requestId === state.currentAutonameRequestId) {
        setSpinnerVisible(false);
      }
    }
  }

  function validate() {
    const prompt = els.prompt.value.trim();
    if (!prompt) {
      setStatus('Please enter a prompt.', 'error');
      return false;
    }
    const providers = getSelectedProviders();
    if (providers.length === 0) {
      setStatus('Select at least one provider.', 'error');
      return false;
    }
    return true;
  }

  async function handleSend() {
    if (state.sending) return;
    clearStatus();
    if (!validate()) return;

    const prompt = els.prompt.value.trim();
    const providers = getSelectedProviders();
    const options = {
      research: !!els.research.checked,
      incognito: !!els.incognito.checked
    };

    const isNew = els.sessionSelect.value === '__new__';
    setLoading(true);

    try {
      if (isNew) {
        const title = els.groupTitle.value.trim() || 'llm-burst';
        const resp = await sendMessage('llmburst-start-new-session', {
          title, providers, prompt, options
        });
        if (!resp || !resp.ok) {
          setStatus(resp?.error || 'Failed to start session (background not yet updated)', 'error');
          return;
        }
        setStatus('Session started.', 'success');
        // Clear draft after successful send
        await clearDraft();
        // Close popup to get out of the way
        await sleep(300);
        window.close();
      } else {
        const sessionId = els.sessionSelect.value;
        const resp = await sendMessage('llmburst-follow-up', {
          sessionId, prompt
        });
        if (!resp || !resp.ok) {
          setStatus(resp?.error || 'Failed to send follow-up (background not yet updated)', 'error');
          return;
        }
        setStatus('Follow-up sent.', 'success');
        // Clear draft after successful send
        await clearDraft();
        await sleep(300);
        window.close();
      }
    } finally {
      setLoading(false);
    }
  }

  function bindEvents() {
    els.openOptions.addEventListener('click', async () => {
      try {
        await chrome.runtime.openOptionsPage();
      } catch (e) {
        setStatus('Options page not available yet. It will be added in a later phase.', 'info');
      }
    });

    els.sessionSelect.addEventListener('change', () => {
      updateNewSessionVisibility();
      // If switching back to new session, consider auto-naming again
      if (els.sessionSelect.value === '__new__') {
        scheduleAutoName();
      }
    });

    els.groupTitle.addEventListener('input', () => {
      // Mark user-edited; stop auto-overwriting
      state.titleDirty = !!els.groupTitle.value.trim();
    });

    els.prompt.addEventListener('input', () => {
      // Reset auto-name state if title not edited by user
      if (!state.titleDirty) scheduleAutoName();
      clearStatus();
      updateClearButton();
      scheduleDraftSave();
    });

    // Keyboard shortcuts
    els.prompt.addEventListener('keydown', (e) => {
      // Ignore during IME composition
      if (state.isComposing) return;
      
      // Check for Cmd/Ctrl+Enter
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    });

    // IME composition handling
    els.prompt.addEventListener('compositionstart', () => {
      state.isComposing = true;
    });

    els.prompt.addEventListener('compositionend', () => {
      state.isComposing = false;
    });

    // Save draft immediately on blur
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

    // Save draft when page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        const text = els.prompt.value;
        if (text && text !== state.lastDraftText) {
          state.lastDraftText = text;
          saveDraft(text);
        }
      }
    });

    els.sendButton.addEventListener('click', handleSend);
    
    // Paste button handler - with user gesture, clipboard should work
    els.pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().length > 0) {
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
        console.error('[llm-burst] Paste button failed:', e);
        setTimeout(clearStatus, 2000);
      }
    });

    // Clear button handler
    if (els.clearBtn) {
      els.clearBtn.addEventListener('click', handleClear);
    }
  }

  function captureElements() {
    els.openOptions = document.getElementById('openOptions');
    els.prompt = document.getElementById('prompt');
    els.pasteBtn = document.getElementById('pasteBtn');
    els.clearBtn = document.getElementById('clearBtn');
    els.research = document.getElementById('research');
    els.incognito = document.getElementById('incognito');

    els.provChatGPT = document.getElementById('prov-chatgpt');
    els.provClaude = document.getElementById('prov-claude');
    els.provGemini = document.getElementById('prov-gemini');
    els.provGrok = document.getElementById('prov-grok');

    els.sessionSelect = document.getElementById('sessionSelect');
    els.newSessionFields = document.getElementById('newSessionFields');
    els.groupTitle = document.getElementById('groupTitle');
    els.autonameSpinner = document.getElementById('autonameSpinner');

    els.status = document.getElementById('status');
    els.sendButton = document.getElementById('sendButton');
  }

  async function init() {
    captureElements();
    bindEvents();
    updateNewSessionVisibility();
    setStatus('Loading sessions...', 'info');
    
    // Update keyboard shortcut hint based on platform
    const shortcutKey = document.getElementById('shortcutKey');
    if (shortcutKey) {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      shortcutKey.textContent = isMac ? 'Cmd+Enter' : 'Ctrl+Enter';
    }

    await Promise.all([
      loadDefaults(),
      loadSessions(),
      prefillFromClipboard().catch(() => {})
    ]);

    // Focus prompt for quick paste
    els.prompt.focus();
    clearStatus();

    // Update clear button visibility
    updateClearButton();

    // Attempt auto-naming if prompt has content and user hasn't edited title
    scheduleAutoName();
  }

  // Wait for both DOM and dynamic content to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Give ui.js time to render
      setTimeout(init, 50);
    });
  } else {
    // DOM already loaded, but still wait for ui.js
    setTimeout(init, 50);
  }
})();