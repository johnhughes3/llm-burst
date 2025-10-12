/**
 * LLM Burst - Content Router
 * Listens for background "llmburst-inject" messages and dispatches them
 * to provider injectors under window.llmBurst.injectors.
 *
 * Contract:
 *  - Message: { type: 'llmburst-inject', provider: 'CHATGPT'|'CLAUDE'|'GEMINI'|'GROK',
 *               mode: 'submit'|'followup', prompt: string,
 *               options?: { research?: boolean, incognito?: boolean } }
 *  - Response: { ok: true, result?: any } or { ok: false, error: string }
 */
(function() {
  'use strict';

  // Ensure namespace
  const ns = (window.llmBurst = window.llmBurst || {});
  ns.injectors = ns.injectors || {};

  function log(...args) {
    try { console.debug('[llm-burst][router]', ...args); } catch {}
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));

  /**
   * Wait for a provider injector to become available.
   * @param {string} provider
   * @param {number} timeout
   * @returns {Promise<{ submit: Function, followup?: Function }>}
   */
  async function waitForInjector(provider, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const inj = ns.injectors && ns.injectors[provider];
      if (inj && typeof inj.submit === 'function') {
        return inj;
      }
      await wait(50);
    }
    throw new Error(`Injector not found for provider: ${provider}`);
  }

  /**
   * Handle injection message by dispatching to the appropriate injector.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        if (!message || typeof message !== 'object') return;

        const { type } = message;

        if (type === 'llmburst-inject') {
          const provider = message.provider;
          const mode = message.mode || 'submit';
          const prompt = String(message.prompt || '');
          const options = message.options || {};

          if (!provider) throw new Error('provider is required');
          if (!prompt || prompt.trim().length === 0) throw new Error('prompt is required');

          const injector = await waitForInjector(provider, 7000);
          const fn = mode === 'followup' ? injector.followup : injector.submit;

          if (typeof fn !== 'function') {
            throw new Error(`Injector function for mode "${mode}" not implemented for ${provider}`);
          }

          const result = await fn({ prompt, options });

          if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
            sendResponse(result);
          } else {
            sendResponse({ ok: true, result: result ?? null });
          }
          return;
        }

        if (type === 'llmburst-router-ping') {
          sendResponse({ ok: true, router: 'ready' });
          return;
        }
      } catch (error) {
        const payload = {
          ok: false,
          error: error?.message || String(error)
        };

        if (error && typeof error === 'object') {
          if (typeof error.code === 'string') payload.code = error.code;
          if (typeof error.state === 'string') payload.state = error.state;
          if (Object.prototype.hasOwnProperty.call(error, 'details')) payload.details = error.details;
        }

        sendResponse(payload);
      }
    })();

    // Keep the message channel open for async response
    return true;
  });

  log('Content router initialized');
})();
