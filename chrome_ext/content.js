// LLM Burst Helper Extension - Content Script
// Bridges communication between web pages and the extension background without page script injection.
// Note: Inline script injection (window.__llmBurstExtension) was removed to comply with site CSPs.

(function() {
  'use strict';

  let responseId = 0;

  // Send message to background and return response
  async function relayToBackground(data) {
    try {
      const response = await chrome.runtime.sendMessage(data);
      return response;
    } catch (error) {
      console.error('Failed to relay message to background:', error);
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // Handle messages from the page (no inline script injection, just postMessage relay)
  window.addEventListener('message', async (event) => {
    // Only process messages from the same window
    if (event.source !== window) return;

    const data = event.data;

    // Process only llmburst-* messages
    if (!data || typeof data !== 'object' || !data.type || typeof data.type !== 'string' || !data.type.startsWith('llmburst-')) {
      return;
    }

    const currentResponseId = ++responseId;
    const responseType = `${data.type}-response`;

    try {
      // Basic ping support
      if (data.type === 'llmburst-ping') {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          window.postMessage({
            type: responseType,
            responseId: currentResponseId,
            ok: false,
            error: 'Extension context not available'
          }, '*');
          return;
        }
        const response = await relayToBackground(data);
        window.postMessage({
          type: responseType,
          responseId: currentResponseId,
          ...response
        }, '*');
        return;
      }

      // Relay any other llmburst-* message to background
      const response = await relayToBackground(data);
      window.postMessage({
        type: responseType,
        responseId: currentResponseId,
        requestType: data.type,
        ...response
      }, '*');
    } catch (error) {
      window.postMessage({
        type: responseType,
        responseId: currentResponseId,
        requestType: data.type,
        ok: false,
        error: error?.message || String(error)
      }, '*');
    }
  });

  console.log('LLM Burst Helper content script loaded (no inline injection)');
})();