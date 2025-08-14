/**
 * LLM Burst Helper Extension - Content Script
 * Bridges communication between web pages and the extension background
 */

(function() {
  'use strict';
  
  // Track pending responses for async communication
  const pendingResponses = new Map();
  let responseId = 0;
  
  /**
   * Send message to background and return response via postMessage
   */
  async function relayToBackground(data) {
    try {
      const response = await chrome.runtime.sendMessage(data);
      return response;
    } catch (error) {
      console.error('Failed to relay message to background:', error);
      return { ok: false, error: error.message || String(error) };
    }
  }
  
  /**
   * Handle messages from the page
   */
  window.addEventListener('message', async (event) => {
    // Only process messages from the same window
    if (event.source !== window) return;
    
    const data = event.data;
    
    // Check if this is an LLM Burst message
    if (!data || typeof data !== 'object' || !data.type?.startsWith('llmburst-')) {
      return;
    }
    
    // Generate response ID for tracking
    const currentResponseId = ++responseId;
    const responseType = `${data.type}-response`;
    
    try {
      // Special handling for ping - immediate response
      if (data.type === 'llmburst-ping') {
        // First check if extension context is available
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          window.postMessage({
            type: responseType,
            responseId: currentResponseId,
            ok: false,
            error: 'Extension context not available'
          }, '*');
          return;
        }
        
        // Send ping to background
        const response = await relayToBackground(data);
        
        // Post response back to page
        window.postMessage({
          type: responseType,
          responseId: currentResponseId,
          ...response
        }, '*');
        return;
      }
      
      // For all other messages, relay to background
      const response = await relayToBackground(data);
      
      // Post response back to page
      window.postMessage({
        type: responseType,
        responseId: currentResponseId,
        requestType: data.type,
        ...response
      }, '*');
      
    } catch (error) {
      // Post error response back to page
      window.postMessage({
        type: responseType,
        responseId: currentResponseId,
        requestType: data.type,
        ok: false,
        error: error.message || String(error)
      }, '*');
    }
  });
  
  /**
   * Inject a helper function into the page for easier communication
   */
  const script = document.createElement('script');
  script.textContent = `
    (function() {
      window.__llmBurstExtension = {
        // Check if extension is available
        async ping() {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 1000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-ping-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ type: 'llmburst-ping' }, '*');
          });
        },
        
        // Add current tab to a group
        async addToGroup(title, color, sessionId) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 5000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-group-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ 
              type: 'llmburst-group',
              title,
              color,
              sessionId
            }, '*');
          });
        },
        
        // Open new tabs
        async openTabs(urls, options = {}) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 10000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-open-tabs-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ 
              type: 'llmburst-open-tabs',
              urls,
              ...options
            }, '*');
          });
        },
        
        // Create a tab group
        async createGroup(tabIds, options = {}) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 5000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-create-group-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ 
              type: 'llmburst-create-group',
              tabIds,
              ...options
            }, '*');
          });
        },
        
        // Combine windows into groups
        async combineWindows(sessionId, targetWindowId) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 10000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-combine-windows-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ 
              type: 'llmburst-combine-windows',
              sessionId,
              targetWindowId
            }, '*');
          });
        },
        
        // Get session info
        async getSessionInfo(sessionId) {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              resolve({ ok: false, error: 'Timeout waiting for extension response' });
            }, 2000);
            
            const handler = (event) => {
              if (event.data?.type === 'llmburst-session-info-response') {
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(event.data);
              }
            };
            
            window.addEventListener('message', handler);
            window.postMessage({ 
              type: 'llmburst-session-info',
              sessionId
            }, '*');
          });
        }
      };
      
      // Dispatch event to signal extension is ready
      window.dispatchEvent(new CustomEvent('llmburst-extension-ready', {
        detail: { version: '1.0.0' }
      }));
    })();
  `;
  
  // Inject at document start
  if (document.head) {
    document.head.appendChild(script);
  } else {
    // Wait for head to be available
    const observer = new MutationObserver(() => {
      if (document.head) {
        document.head.appendChild(script);
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true });
  }
  
  // Clean up injected script
  setTimeout(() => {
    if (script.parentNode) {
      script.remove();
    }
  }, 100);
  
  console.log('LLM Burst Helper content script loaded');
})();