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
    sendOnEnter: false,
    // Session picker
    selectedSessionId: '__new__',
    sessionsById: {},
    sessionOrder: [],
    pickerOpen: false,
    confirmingDelete: null,
    confirmTimer: null,
    // Draft indicator
    draftSaved: false,
    noticeActive: false,
    noticeTimer: null
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

  // Persistent, quiet draft indicator: appears once and stays put instead of
  // flashing on every debounced save while the user types.
  function renderDraftStatus() {
    if (!els.draftStatus || state.noticeActive) return;
    if (state.draftSaved) {
      els.draftStatus.textContent = 'Draft saved';
      els.draftStatus.classList.add('prompt__draft-status--persistent');
      els.draftStatus.classList.remove('animate-fade');
      els.draftStatus.style.display = 'inline-block';
    } else {
      els.draftStatus.style.display = 'none';
      els.draftStatus.classList.remove('prompt__draft-status--persistent');
    }
  }

  // Transient inline notice (paste/restore/etc.); temporarily overrides the
  // persistent draft indicator, then restores it.
  function showInlineNotice(text) {
    if (!els.draftStatus) return;
    state.noticeActive = true;
    els.draftStatus.textContent = text;
    els.draftStatus.classList.remove('prompt__draft-status--persistent');
    els.draftStatus.style.display = 'inline-block';
    // Restart the fade animation even when a notice is already showing
    els.draftStatus.classList.remove('animate-fade');
    void els.draftStatus.offsetWidth;
    els.draftStatus.classList.add('animate-fade');
    if (state.noticeTimer) clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => {
      state.noticeActive = false;
      if (!els?.draftStatus) return;
      els.draftStatus.style.display = 'none';
      els.draftStatus.classList.remove('animate-fade');
      renderDraftStatus();
    }, 2000);
  }

  function setLoading(isLoading) {
    state.sending = isLoading;
    if (els.sendButton) {
      els.sendButton.disabled = isLoading;
      els.sendButton.classList.toggle('send-button--loading', isLoading);
      els.sendButton.setAttribute('aria-busy', String(isLoading));
    }
    const label = document.getElementById('sendButtonText');
    if (label) {
      if (isLoading) {
        label.textContent = state.isNewSession ? 'Opening tabs…' : 'Sending…';
      } else {
        label.textContent = state.isNewSession ? 'Send' : 'Continue Thread';
      }
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

      state.draftSaved = true;
      renderDraftStatus();
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
      state.draftSaved = false;
      renderDraftStatus();
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
        state.draftSaved = true;
        state.lastDraftText = draft;
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
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const modEnter = isMac ? '⌘+Enter' : 'Ctrl+Enter';
    const hint = document.getElementById('promptHint');
    if (hint) {
      hint.textContent = state.sendOnEnter ? 'Enter to send (Shift+Enter for newline)' : `${modEnter} to send`;
    }
    const btnShortcut = document.querySelector('.send-button__shortcut');
    if (btnShortcut) {
      btnShortcut.textContent = state.sendOnEnter ? 'Enter' : modEnter;
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
    const isNew = state.selectedSessionId === '__new__';
    if (!isNew) return;
    const selected = getSelectedProviders();
    if (selected.length === 0) {
      setProviders(getAllProviderIds());
    }
    if (els.research?.checked) {
      deselectProvider('GROK');
    }
  }

  // ----- Session picker (custom combobox) -----

  const PROVIDER_LABELS = {
    CHATGPT: 'ChatGPT',
    CLAUDE: 'Claude',
    GEMINI: 'Gemini',
    GROK: 'Grok'
  };

  function formatRelativeTime(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // Long form for accessible names ("3 hours ago" instead of "3h")
  function formatRelativeTimeLong(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }

  // Visually-hidden live region for picker state changes (arm/cancel delete)
  function announcePicker(text) {
    if (els.pickerStatus) els.pickerStatus.textContent = text;
  }

  function sessionTitle(id) {
    if (id === '__new__') return 'New conversation';
    const sess = state.sessionsById[id];
    return (sess && sess.title) || `Session ${id}`;
  }

  function updateTriggerText() {
    if (els.sessionTriggerText) {
      els.sessionTriggerText.textContent = sessionTitle(state.selectedSessionId);
    }
  }

  function selectSession(id) {
    state.selectedSessionId = id;
    updateTriggerText();
    updateUIState();
  }

  // Load sessions from storage into state
  async function loadSessions() {
    try {
      const result = await chrome.storage.local.get(['sessions', 'sessionOrder']);
      state.sessionsById = result.sessions || {};
      // Most recently used first (storage order is append-order)
      state.sessionOrder = (result.sessionOrder || Object.keys(state.sessionsById))
        .filter(id => state.sessionsById[id])
        .sort((a, b) => {
          const sa = state.sessionsById[a];
          const sb = state.sessionsById[b];
          return (sb.lastUsedAt || sb.createdAt || 0) - (sa.lastUsedAt || sa.createdAt || 0);
        });

      // If the selected session disappeared, fall back to a new conversation
      if (state.selectedSessionId !== '__new__' && !state.sessionsById[state.selectedSessionId]) {
        selectSession('__new__');
      } else {
        updateTriggerText();
      }
      clearStatus();
    } catch (e) {
      console.error('[llm-burst] Failed to load sessions:', e);
      setStatus('Failed to load sessions', 'error');
    }
  }

  function buildSessionOption(id) {
    const isNew = id === '__new__';
    const sess = isNew ? null : state.sessionsById[id];
    const icons = window.llmBurstIcons;

    const opt = document.createElement('div');
    opt.className = 'session-option';
    opt.setAttribute('role', 'option');
    opt.tabIndex = -1;
    opt.dataset.sessionId = id;
    opt.setAttribute('aria-selected', String(state.selectedSessionId === id));

    if (isNew) {
      const badge = document.createElement('span');
      badge.className = 'session-option__icon';
      if (icons) badge.appendChild(icons.createIcon('plus', 12));
      opt.appendChild(badge);
    } else {
      const dots = document.createElement('span');
      dots.className = 'session-option__dots';
      const provs = Array.isArray(sess.providers) ? sess.providers : [];
      Object.keys(PROVIDER_LABELS)
        .filter(p => provs.includes(p))
        .forEach(p => {
          const dot = document.createElement('span');
          dot.className = `session-option__dot session-option__dot--${p.toLowerCase()}`;
          dot.title = PROVIDER_LABELS[p];
          dots.appendChild(dot);
        });
      opt.appendChild(dots);
    }

    const title = document.createElement('span');
    title.className = 'session-option__title';
    title.textContent = sessionTitle(id);
    opt.appendChild(title);

    if (!isNew) {
      const when = sess.lastUsedAt || sess.createdAt;

      // Dots and the compact time are visual-only; give AT the full picture
      const provNames = (Array.isArray(sess.providers) ? sess.providers : [])
        .map(p => PROVIDER_LABELS[p])
        .filter(Boolean);
      const labelParts = [sessionTitle(id)];
      if (provNames.length) labelParts.push(provNames.join(', '));
      if (when) labelParts.push(`last used ${formatRelativeTimeLong(when)}`);
      opt.setAttribute('aria-label', labelParts.join(', '));
      if (when) {
        const time = document.createElement('span');
        time.className = 'session-option__time';
        time.textContent = formatRelativeTime(when);
        time.title = new Date(when).toLocaleString();
        opt.appendChild(time);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'session-option__delete';
      del.tabIndex = -1;
      del.setAttribute('aria-label', `Forget "${sessionTitle(id)}" (tabs stay open)`);
      del.title = 'Forget this chat (tabs stay open)';
      if (icons) del.appendChild(icons.createIcon('x', 12));
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteClick(id, del);
      });
      opt.appendChild(del);
    }

    opt.addEventListener('click', () => {
      selectSession(id);
      closeSessionMenu();
    });

    return opt;
  }

  function renderSessionMenu() {
    const menu = els.sessionMenu;
    if (!menu) return;
    resetDeleteConfirm();
    menu.textContent = '';
    menu.appendChild(buildSessionOption('__new__'));

    if (state.sessionOrder.length > 0) {
      const divider = document.createElement('div');
      divider.className = 'session-picker__divider';
      divider.setAttribute('aria-hidden', 'true');
      menu.appendChild(divider);
      state.sessionOrder.forEach(id => menu.appendChild(buildSessionOption(id)));
    } else {
      const empty = document.createElement('div');
      empty.className = 'session-picker__empty';
      empty.textContent = 'Saved chats appear here after you send.';
      menu.appendChild(empty);
    }
  }

  function menuOptions() {
    return els.sessionMenu
      ? Array.from(els.sessionMenu.querySelectorAll('[role="option"]'))
      : [];
  }

  function openSessionMenu() {
    if (!els.sessionMenu || state.pickerOpen) return;
    renderSessionMenu();
    state.pickerOpen = true;
    els.sessionMenu.hidden = false;
    els.sessionPicker?.classList.add('session-picker--open');
    els.sessionTrigger?.setAttribute('aria-expanded', 'true');
    const opts = menuOptions();
    const current = opts.find(o => o.dataset.sessionId === state.selectedSessionId) || opts[0];
    current?.focus();
  }

  function closeSessionMenu(focusTrigger = true) {
    if (!state.pickerOpen) return;
    resetDeleteConfirm();
    state.pickerOpen = false;
    if (els.sessionMenu) els.sessionMenu.hidden = true;
    els.sessionPicker?.classList.remove('session-picker--open');
    els.sessionTrigger?.setAttribute('aria-expanded', 'false');
    if (focusTrigger) els.sessionTrigger?.focus();
  }

  function resetDeleteConfirm() {
    state.confirmingDelete = null;
    if (state.confirmTimer) {
      clearTimeout(state.confirmTimer);
      state.confirmTimer = null;
    }
    els.sessionMenu?.querySelectorAll('.session-option__delete--confirm').forEach(btn => {
      btn.classList.remove('session-option__delete--confirm');
      btn.title = 'Forget this chat (tabs stay open)';
      const id = btn.closest('[role="option"]')?.dataset?.sessionId;
      if (id) btn.setAttribute('aria-label', `Forget "${sessionTitle(id)}" (tabs stay open)`);
    });
  }

  // Two-click confirm: first click arms the button, second click deletes.
  function handleDeleteClick(sessionId, btn) {
    if (state.confirmingDelete === sessionId) {
      forgetSession(sessionId);
      return;
    }
    resetDeleteConfirm();
    state.confirmingDelete = sessionId;
    btn.classList.add('session-option__delete--confirm');
    btn.title = 'Click again to confirm';
    btn.setAttribute('aria-label', `Confirm forgetting "${sessionTitle(sessionId)}"`);
    announcePicker(`Press Delete again to forget "${sessionTitle(sessionId)}". Tabs stay open.`);
    state.confirmTimer = setTimeout(() => {
      resetDeleteConfirm();
      announcePicker('Deletion cancelled');
    }, 3000);
  }

  async function forgetSession(sessionId) {
    resetDeleteConfirm();
    const result = await sendMessage('llmburst-delete-session', { sessionId });
    if (!result.ok) {
      setStatus(result.error || 'Failed to forget chat', 'error');
      return;
    }
    await loadSessions();
    if (state.pickerOpen) {
      renderSessionMenu();
      menuOptions()[0]?.focus();
    }
    showInlineNotice('Chat forgotten — tabs stay open');
  }

  // Update UI state based on session selection
  function updateUIState() {
    const isNew = state.selectedSessionId === '__new__';
    state.isNewSession = isNew;
    
    // Add/remove class on app container for layout adjustment
    const app = document.querySelector('.app');
    if (app) {
      app.classList.toggle('app--existing-conversation', !isNew);
    }
    
    // For existing conversations, hide the entire advanced section
    const advancedSection = document.getElementById('advancedSection');
    if (advancedSection) {
      advancedSection.classList.toggle('section--hidden', !isNew);
      advancedSection.setAttribute('aria-hidden', String(!isNew));
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
    
    const sessionId = state.selectedSessionId;
    const isNew = sessionId === '__new__';
    
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
        selectSession(result.sessionId);
      }
      
      setTimeout(() => window.close(), 1500);
    } else {
      setStatus(result.error || 'Failed to send', 'error');
    }
  }

  // Bind events
  function bindEvents() {
    // Session picker trigger
    if (els.sessionTrigger) {
      els.sessionTrigger.addEventListener('click', () => {
        if (state.pickerOpen) {
          closeSessionMenu();
        } else {
          openSessionMenu();
        }
      });
      els.sessionTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          openSessionMenu();
        }
      });
    }

    // Session picker menu: roving focus over [role="option"] rows
    if (els.sessionMenu) {
      // Clicking dead zones (divider, padding, empty-state row) must not blur
      // the focused option, or keyboard navigation strands until Escape.
      els.sessionMenu.addEventListener('mousedown', (e) => {
        if (!e.target.closest('[role="option"], .session-option__delete')) {
          e.preventDefault();
        }
      });
      els.sessionMenu.addEventListener('keydown', (e) => {
        const opts = menuOptions();
        const idx = opts.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          opts[Math.min(idx + 1, opts.length - 1)]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          opts[Math.max(idx - 1, 0)]?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          opts[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          opts[opts.length - 1]?.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const target = document.activeElement;
          if (target?.dataset?.sessionId) {
            selectSession(target.dataset.sessionId);
            closeSessionMenu();
          }
        } else if (e.key === 'Escape') {
          // Close only the menu, not the whole popup
          e.preventDefault();
          e.stopPropagation();
          closeSessionMenu();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          const target = document.activeElement;
          const id = target?.dataset?.sessionId;
          if (id && id !== '__new__') {
            e.preventDefault();
            const btn = target.querySelector('.session-option__delete');
            if (btn) handleDeleteClick(id, btn);
          }
        } else if (e.key === 'Tab') {
          closeSessionMenu(false);
        }
      });
    }

    // Close the picker when clicking anywhere outside it
    document.addEventListener('mousedown', (e) => {
      if (state.pickerOpen && els.sessionPicker && !els.sessionPicker.contains(e.target)) {
        closeSessionMenu(false);
      }
    });
    
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

      // Esc closes the session menu first, then the popup/launcher
      if (e.key === 'Escape' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (state.pickerOpen) {
          closeSessionMenu();
          return;
        }
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
    els.sessionPicker = document.getElementById('sessionPicker');
    els.sessionTrigger = document.getElementById('sessionTrigger');
    els.sessionTriggerText = document.getElementById('sessionTriggerText');
    els.sessionMenu = document.getElementById('sessionMenu');
    els.pickerStatus = document.getElementById('pickerStatus');
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
