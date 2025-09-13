(function() {
  'use strict';

  const els = {};

  function $(id) { return document.getElementById(id); }

  function setStatus(text, kind = 'info') {
    els.status.textContent = text || '';
    els.status.classList.remove('success', 'error', 'info');
    els.status.classList.add(kind);
  }

  function getSelectedProviders() {
    const keys = [];
    const boxes = [
      els.defProvChatGPT,
      els.defProvClaude,
      els.defProvGemini,
      els.defProvGrok
    ];
    for (const cb of boxes) {
      if (cb.checked) {
        const key = cb.getAttribute('data-provider');
        if (key) keys.push(key);
      }
    }
    return keys;
  }

  function setSelectedProviders(providerKeys) {
    const set = new Set(providerKeys || []);
    els.defProvChatGPT.checked = set.has('CHATGPT');
    els.defProvClaude.checked = set.has('CLAUDE');
    els.defProvGemini.checked = set.has('GEMINI');
    els.defProvGrok.checked = set.has('GROK');
  }

  function captureElements() {
    els.geminiApiKey = $('geminiApiKey');
    els.toggleKey = $('toggleKey');
    els.geminiModel = $('geminiModel');

    els.defaultResearch = $('defaultResearch');
    els.defaultIncognito = $('defaultIncognito');

    els.defProvChatGPT = $('def-prov-chatgpt');
    els.defProvClaude = $('def-prov-claude');
    els.defProvGemini = $('def-prov-gemini');
    els.defProvGrok = $('def-prov-grok');

    els.saveBtn = $('saveBtn');
    els.resetBtn = $('resetBtn');
    els.saveDefaultsBtn = $('saveDefaultsBtn');

    els.status = $('status');

    els.debuggerStatus = $('debuggerStatus');
  }

  async function loadOptions() {
    setStatus('Loading...', 'info');
    try {
      const data = await chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'settings']);
      const { geminiApiKey = '', geminiModel = '' } = data;
      const settings = data.settings || {};

      els.geminiApiKey.value = geminiApiKey;
      els.geminiModel.value = geminiModel;

      els.defaultResearch.checked = !!settings.defaultResearch;
      els.defaultIncognito.checked = !!settings.defaultIncognito;
      setSelectedProviders(settings.defaultProviders || ['CHATGPT', 'CLAUDE', 'GEMINI', 'GROK']);

      setStatus('Loaded.', 'info');
    } catch (e) {
      setStatus('Failed to load options', 'error');
    }
  }

  async function saveApiConfig() {
    try {
      const geminiApiKey = (els.geminiApiKey.value || '').trim();
      const geminiModel = (els.geminiModel.value || '').trim();
      await chrome.storage.sync.set({ geminiApiKey, geminiModel });
      setStatus('Saved API settings.', 'success');
    } catch (e) {
      setStatus('Failed to save API settings', 'error');
    }
  }

  async function saveDefaults() {
    try {
      const settings = {
        defaultResearch: !!els.defaultResearch.checked,
        defaultIncognito: !!els.defaultIncognito.checked,
        defaultProviders: getSelectedProviders()
      };
      await chrome.storage.sync.set({ settings });
      setStatus('Saved defaults.', 'success');
    } catch (e) {
      setStatus('Failed to save defaults', 'error');
    }
  }

  function restoreDefaults() {
    // Recommended defaults
    els.defaultResearch.checked = false;
    els.defaultIncognito.checked = false;
    setSelectedProviders(['CHATGPT', 'CLAUDE', 'GEMINI', 'GROK']);
    els.geminiModel.value = '';
    setStatus('Defaults restored (not yet saved).', 'info');
  }

  function bindEvents() {
    els.toggleKey.addEventListener('click', () => {
      const showing = els.geminiApiKey.type === 'text';
      els.geminiApiKey.type = showing ? 'password' : 'text';
      els.toggleKey.textContent = showing ? 'Show' : 'Hide';
    });

    els.saveBtn.addEventListener('click', async () => {
      await saveApiConfig();
    });

    els.saveDefaultsBtn.addEventListener('click', async () => {
      await saveDefaults();
    });

    els.resetBtn.addEventListener('click', () => {
      restoreDefaults();
    });

    // No handlers required; permission is now required in manifest
  }

  async function refreshDebuggerUI() {
    if (els.debuggerStatus) {
      els.debuggerStatus.textContent = 'Trusted clicks are enabled by default.';
      els.debuggerStatus.className = 'status success';
    }
  }

  async function init() {
    captureElements();
    bindEvents();
    await loadOptions();
    await refreshDebuggerUI();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
