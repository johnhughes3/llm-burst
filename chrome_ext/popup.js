(function() {
  'use strict';

  const els = {};
  const state = {
    titleDirty: false,
    sending: false,
    currentAutonameRequestId: 0,
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

  // Clipboard prefill (best-effort)
  async function prefillFromClipboard() {
    try {
      // navigator.clipboard.readText may require permission; it's fine if it fails
      const current = els.prompt.value.trim();
      if (current.length > 0) return; // Don't override user input
      const text = await navigator.clipboard.readText();
      if (text && text.trim().length > 0) {
        els.prompt.value = text.trim();
        // Trigger input handlers
        els.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch {
      // ignore
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

      if (resp && resp.ok && !state.titleDirty && els.sessionSelect.value === '__new__') {
        const title = sanitizeTitle(resp.title);
        if (title && !els.groupTitle.value) {
          els.groupTitle.value = title;
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
    });

    els.sendButton.addEventListener('click', handleSend);
  }

  function captureElements() {
    els.openOptions = document.getElementById('openOptions');
    els.prompt = document.getElementById('prompt');
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

    await Promise.all([
      loadDefaults(),
      loadSessions(),
      prefillFromClipboard().catch(() => {})
    ]);

    // Focus prompt for quick paste
    els.prompt.focus();
    clearStatus();

    // Attempt auto-naming if prompt has content and user hasn't edited title
    scheduleAutoName();
  }

  document.addEventListener('DOMContentLoaded', init);
})();