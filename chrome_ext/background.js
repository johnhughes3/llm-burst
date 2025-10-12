/**
 * LLM Burst Helper Extension - Background Service Worker
 * Orchestrates sessions, provider tabs, tab grouping, and auto-naming.
 *
 * Key responsibilities:
 * - Manage persistent sessions: { id, title, providers, options, tabs }
 * - Open/group tabs for providers, track tab & window mappings
 * - Inject prompts into tabs via content scripts (submit / follow-up)
 * - Provide auto-naming via Gemini API using chrome.storage.sync credentials
 * - Maintain backward compatibility with existing helper messages
 */

// ============================================================================
// Constants
// ============================================================================

const ALLOWED_COLORS = new Set([
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
]);

const DEFAULT_COLOR = 'blue';
const EXTENSION_VERSION = '1.0.0';

// Providers registry with URLs and default group colors
const PROVIDERS = {
  CHATGPT: {
    key: 'CHATGPT',
    title: 'ChatGPT',
    color: 'green',
    urls: {
      base: 'https://chatgpt.com/?model=gpt-5-pro',
      incognito: 'https://chatgpt.com/?temporary-chat=true&model=gpt-5-thinking',
      research: 'https://chatgpt.com/g/g-p-68034199ee048191a6fe21d2dacdef09-research-prompts/project?model=gpt-5-pro'
    }
  },
  CLAUDE: {
    key: 'CLAUDE',
    title: 'Claude',
    color: 'yellow',
    urls: { base: 'https://claude.ai/new' }
  },
  GEMINI: {
    key: 'GEMINI',
    title: 'Gemini',
    color: 'blue',
    urls: { base: 'https://gemini.google.com/app' }
  },
  GROK: {
    key: 'GROK',
    title: 'Grok',
    color: 'red',
    urls: { base: 'https://grok.com' }
  }
};

const PROVIDER_KEYS = Object.keys(PROVIDERS);
const DEFAULT_PROVIDER_ORDER = ['CHATGPT', 'CLAUDE', 'GEMINI', 'GROK'];

// Session tracking for window relationships (legacy compatibility)
const sessionWindows = new Map(); // sessionId -> Set<windowId>
const windowSessions = new Map(); // windowId -> sessionId

// ============================================================================
// Utilities
// ============================================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, message = 'Operation timed out') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    })
  ]);
}

// ============================================================================
// Chrome Debugger (CDP) helpers for trusted clicks
// ============================================================================

const CDP_VERSION = '1.3';

function dbgAttach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });
}

function dbgDetach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function dbgSend(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(result);
    });
  });
}

async function dbgEval(tabId, expression) {
  const res = await dbgSend(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (res?.exceptionDetails) {
    throw new Error('Evaluation failed');
  }
  return res?.result?.value ?? null;
}

async function dbgWaitFor(tabId, expression, { timeout = 3000, interval = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await dbgEval(tabId, expression);
      if (v) return v;
    } catch { /* ignore */ }
    await delay(interval);
  }
  return null;
}

async function dbgGetCenterXYBySelector(tabId, selector) {
  const expr = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rr = el.getBoundingClientRect();
    return { x: Math.round(rr.left + rr.width/2), y: Math.round(rr.top + rr.height/2) };
  })();`;
  return dbgEval(tabId, expr);
}

async function dbgGetCenterXYForMenuItem(tabId, labels = ['deep research', 'research']) {
  const expr = `(() => {
    const labs = ${JSON.stringify(labels.map((s) => s.toLowerCase()))};
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    // First check in portal/overlay containers
    const portals = document.querySelectorAll('[data-radix-portal], [data-radix-popper-content-wrapper], [role="dialog"]');
    let root = document;
    if (portals.length > 0) {
      root = portals[portals.length - 1]; // Use the most recent portal
    }

    // Expanded selector to catch all possible menu items
    const selectors = [
      '[role="menuitemradio"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[data-radix-collection-item]',
      'button[role="menuitemradio"]',
      'button[role="menuitem"]',
      'div[role="menuitemradio"]',
      'div[role="menuitem"]'
    ];

    const items = Array.from(root.querySelectorAll(selectors.join(', ')));

    // Also check in the main document if we didn't find in portal
    if (items.length === 0 && root !== document) {
      items.push(...Array.from(document.querySelectorAll(selectors.join(', '))));
    }

    console.log('[CDP] Found', items.length, 'menu items');

    for (const el of items) {
      const txt = norm(el.innerText || el.textContent || '');
      const aria = norm(el.getAttribute('aria-label') || '');

      console.log('[CDP] Checking item:', txt || aria);

      if (labs.some((l) => txt.includes(l) || aria.includes(l))) {
        console.log('[CDP] Found matching item:', txt || aria);

        // Make sure element is visible
        if (el.offsetParent === null) {
          console.log('[CDP] Element is hidden, skipping');
          continue;
        }

        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });

        // Wait a moment for scroll to complete
        return new Promise(resolve => {
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            if (!r || r.width === 0 || r.height === 0) {
              console.log('[CDP] Element has no dimensions');
              resolve(null);
              return;
            }

            // Find the actual clickable area - check for text/svg elements inside
            const textEl = el.querySelector('span, div, p') || el;
            const textRect = textEl.getBoundingClientRect();

            // Use text element position if available, otherwise use main element
            const targetX = textRect.left + Math.min(30, textRect.width / 2);
            const targetY = textRect.top + textRect.height / 2;

            console.log('[CDP] Target coordinates:', targetX, targetY);

            // Verify the click target
            const elAt = document.elementFromPoint(targetX, targetY);
            const isValid = elAt && (elAt === el || el.contains(elAt) || elAt.closest('[role="menuitemradio"], [role="menuitem"]') === el);

            if (!isValid) {
              console.log('[CDP] Click target verification failed, trying center');
              // Fallback to center
              resolve({
                x: Math.round(r.left + r.width / 2),
                y: Math.round(r.top + r.height / 2),
                element: el.outerHTML.substring(0, 100)
              });
            } else {
              resolve({
                x: Math.round(targetX),
                y: Math.round(targetY),
                element: el.outerHTML.substring(0, 100)
              });
            }
          }, 50);
        });
      }
    }

    console.log('[CDP] No matching menu item found');
    return null;
  })();`;
  return dbgEval(tabId, expr);
}

async function dbgTrustedClickXY(tabId, x, y) {
  await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 1 });
  await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 1, clickCount: 1 });
}

async function enableChatGPTResearchViaCDP(tabId, { timeoutMs = 6000 } = {}) {
  console.log('[CDP] Starting ChatGPT Research mode activation via debugger...');
  await dbgAttach(tabId);
  try {
    await dbgSend(tabId, 'Runtime.enable');
    await dbgSend(tabId, 'DOM.enable');
    await dbgSend(tabId, 'Console.enable');

    // 0) Wait for page to be ready - check for key ChatGPT UI elements
    console.log('[CDP] Waiting for ChatGPT UI to be ready...');
    const pageReady = await dbgWaitFor(
      tabId,
      `(() => {
        // Check for editor and model selector as signs page is loaded
        const editor = document.querySelector('#prompt-textarea, .ProseMirror, [contenteditable="true"]');
        const modelBtn = document.querySelector('button[aria-label*="Model" i], button[aria-haspopup="menu"]');
        return (editor && modelBtn) ? true : false;
      })()`,
      { timeout: Math.min(timeoutMs, 5000) }
    );

    if (!pageReady) {
      console.warn('[CDP] Page not fully loaded yet, but continuing anyway...');
    } else {
      console.log('[CDP] Page ready, proceeding with activation...');
      await delay(300); // Small extra delay for hydration
    }

    // 1) Click the composer plus button
    const plusXY = await dbgWaitFor(
      tabId,
      `(() => {
        let el = document.querySelector('[data-testid="composer-plus-btn"]');
        if (!el) {
          const candidates = Array.from(document.querySelectorAll('button[aria-haspopup="menu"], button'));
          for (const b of candidates) {
            const r = b.getBoundingClientRect();
            if (!r || !r.width || !r.height) continue;
            const nearInput = document.querySelector('#prompt-textarea, .ProseMirror, [contenteditable="true"]');
            if (nearInput) {
              const ir = nearInput.getBoundingClientRect();
              if (Math.abs(r.top - ir.top) < 140) { el = b; break; }
            }
          }
        }
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rr = el.getBoundingClientRect();
        return { x: Math.round(rr.left + rr.width/2), y: Math.round(rr.top + rr.height/2) };
      })()`,
      { timeout: timeoutMs }
    );
    if (!plusXY) return { ok: false, error: 'Plus button not found' };

    // Move, then press after a short settle delay
    await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: plusXY.x, y: plusXY.y });
    await delay(100);
    const plusXY2 = await dbgGetCenterXYBySelector(tabId, '[data-testid="composer-plus-btn"]');
    const px = (plusXY2?.x ?? plusXY.x), py = (plusXY2?.y ?? plusXY.y);
    await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1 });
    await dbgSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1 });
    await delay(300);

    // 2) Wait for menu to appear
    const menuAppeared = await dbgWaitFor(tabId, `document.querySelector('[role="menu"], [data-radix-portal], [role="listbox"], [data-state="open"]') ? true : false`, { timeout: timeoutMs });
    if (!menuAppeared) {
      return { ok: false, error: 'Menu did not appear after clicking plus' };
    }

    console.log('[CDP] Menu appeared, trying keyboard navigation approach...');

    // NEW APPROACH: Use keyboard navigation to select Deep Research
    // First, try typing "d" to jump to Deep Research
    console.log('[CDP] Trying to jump to Deep Research by typing "d"...');
    await dbgSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'd',
      code: 'KeyD',
      windowsVirtualKeyCode: 68,
      nativeVirtualKeyCode: 68
    });
    await dbgSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'd',
      code: 'KeyD',
      windowsVirtualKeyCode: 68,
      nativeVirtualKeyCode: 68
    });
    await delay(200);

    // Check if Deep Research is now focused
    const deepResearchFocused = await dbgEval(tabId, `(() => {
      const focused = document.activeElement;
      if (focused) {
        const text = (focused.textContent || '').toLowerCase();
        return text.includes('deep research');
      }
      return false;
    })()`);

    if (!deepResearchFocused) {
      console.log('[CDP] "d" key didn\'t focus Deep Research, trying arrow navigation...');

      // Make sure the menu has focus
      await dbgEval(tabId, `(() => {
        const menu = document.querySelector('[role="menu"]');
        if (menu) {
          const firstItem = menu.querySelector('[role="menuitemradio"], [role="menuitem"]');
          if (firstItem) firstItem.focus();
        }
      })()`);
      await delay(100);

      // Find Deep Research position in menu
      const deepResearchIndex = await dbgEval(tabId, `(() => {
        const items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
        const index = items.findIndex(item => {
          const text = (item.textContent || '').toLowerCase();
          return text.includes('deep research') || text === 'deep research';
        });
        console.log('[CDP] Deep Research found at index:', index, 'of', items.length, 'items');
        return index;
      })()`);

      if (deepResearchIndex === -1) {
        console.log('[CDP] Deep Research not found in menu items');
        return { ok: false, error: 'Deep research option not found in menu' };
      }

      console.log('[CDP] Navigating to Deep Research item at index', deepResearchIndex);

      // Navigate down to the Deep Research item using arrow keys
      for (let i = 0; i < deepResearchIndex; i++) {
        await dbgSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
          nativeVirtualKeyCode: 40
        });
        await dbgSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'ArrowDown',
          code: 'ArrowDown',
          windowsVirtualKeyCode: 40,
          nativeVirtualKeyCode: 40
        });
        await delay(50);
      }
    } else {
      console.log('[CDP] Deep Research appears to be focused after typing "d"');
    }

    // Press Enter to select (or Space for radio buttons)
    console.log('[CDP] Pressing Enter to select Deep Research...');
    await dbgSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await dbgSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await delay(300);

    // Check if menu closed
    const menuClosedAfterEnter = await dbgEval(tabId, `!document.querySelector('[role="menu"], [data-radix-portal]')`);

    if (!menuClosedAfterEnter) {
      console.log('[CDP] Menu still open after Enter, trying Space key...');
      // Try Space key which often works for radio buttons
      await dbgSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32
      });
      await dbgSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: ' ',
        code: 'Space',
        windowsVirtualKeyCode: 32,
        nativeVirtualKeyCode: 32
      });
      await delay(300);
    }


    // 4) Verify activation heuristically
    console.log('[CDP] Verifying Research mode activation...');
    const activated = await dbgWaitFor(
      tabId,
      `(() => {
        // Check heading change
        const h1 = document.querySelector('h1');
        if (h1 && /what are you researching/i.test(h1.textContent || '')) {
          console.log('[CDP] ✓ Heading changed to research mode');
          return true;
        }

        // Check for Research pill/tag
        const pills = document.querySelectorAll('button, [role="button"], .pill, .tag, .badge');
        for (const pill of pills) {
          const text = (pill.textContent || '').toLowerCase();
          const aria = (pill.getAttribute('aria-label') || '').toLowerCase();
          if (text.includes('research') || aria.includes('research')) {
            console.log('[CDP] ✓ Research pill/tag found');
            return true;
          }
        }

        // Check for GitHub Sources button (appears in research mode)
        const sources = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent && b.textContent.includes('Sources')
        );
        if (sources) {
          console.log('[CDP] ✓ Sources button found');
          return true;
        }

        return false;
      })()`,
      { timeout: 2500 }
    );

    if (activated) {
      console.log('[CDP] ✅ Research mode successfully activated!');
    } else {
      console.log('[CDP] ⚠️ Could not verify Research mode activation');
    }

    return { ok: true, activated: !!activated };
  } finally {
    try { await dbgDetach(tabId); } catch {}
  }
}

function generateSessionId() {
  return `burst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeTitle(title) {
  if (!title) return '';
  let t = String(title)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '');
  // Remove trailing separators/punctuation commonly produced by models
  t = t.replace(/[\s]*[\-–—:;,]+$/g, '');
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
}

function getProviderUrl(providerKey, opts = {}) {
  const p = PROVIDERS[providerKey];
  if (!p) throw new Error(`Unknown provider: ${providerKey}`);
  if (providerKey === 'CHATGPT') {
    if (opts.research) return p.urls.research;
    if (opts.incognito) return p.urls.incognito;
    return p.urls.base;
  }
  return p.urls.base;
}

// ============================================================================
// Persistent State (chrome.storage.local)
// ============================================================================
// sessions: { [id]: { id, title, createdAt, lastUsedAt, providers: string[], options: {research, incognito}, tabs: {[prov]: {tabId, windowId, groupId?, url, lastInjectAt?}} } }
// tabIndex: { [tabId]: { sessionId, provider } }
// sessionOrder: string[]

async function loadState() {
  const data = await chrome.storage.local.get(['sessions', 'tabIndex', 'sessionOrder']);
  return {
    sessions: data.sessions || {},
    tabIndex: data.tabIndex || {},
    sessionOrder: data.sessionOrder || []
  };
}

async function saveState(next) {
  await chrome.storage.local.set(next);
}

async function updateState(updater) {
  const state = await loadState();
  const next = await updater(state);
  await saveState(next);
  return next;
}

// ============================================================================
// Tab Group Management
// ============================================================================

/**
 * Find or create a tab group with the given title in a window
 */
async function ensureTabGroup(windowId, title, color = DEFAULT_COLOR) {
  try {
    const groupTitle = String(title || 'llm-burst').slice(0, 80);
    const groupColor = ALLOWED_COLORS.has(color) ? color : DEFAULT_COLOR;

    const existingGroups = await chrome.tabGroups.query({ title: groupTitle, windowId });

    if (existingGroups && existingGroups.length > 0) {
      const group = existingGroups[0];
      if (group.color !== groupColor) {
        await chrome.tabGroups.update(group.id, { color: groupColor });
      }
      return group.id;
    }

    // Return null as marker – caller should create group with tabs
    return null;
  } catch (error) {
    console.error('Failed to ensure tab group:', error);
    throw error;
  }
}

/**
 * Add tabs to a group (by group ID or by creating a new group)
 */
async function addTabsToGroup(tabIds, groupId = null, groupOptions = {}) {
  try {
    if (!Array.isArray(tabIds)) {
      tabIds = [tabIds];
    }

    if (groupId) {
      await chrome.tabs.group({ groupId, tabIds });
      return groupId;
    } else {
      const newGroupId = await chrome.tabs.group({ 
        tabIds,
        createProperties: groupOptions.windowId ? { windowId: groupOptions.windowId } : {}
      });

      if (groupOptions.title || groupOptions.color) {
        await chrome.tabGroups.update(newGroupId, {
          title: groupOptions.title || 'llm-burst',
          color: ALLOWED_COLORS.has(groupOptions.color) ? groupOptions.color : DEFAULT_COLOR,
          collapsed: false
        });
      }

      return newGroupId;
    }
  } catch (error) {
    console.error('Failed to add tabs to group:', error);
    throw error;
  }
}

// ============================================================================
// Legacy Tab Management Helpers (kept for backward compatibility)
// ============================================================================

async function openTabs(urls, options = {}) {
  const { 
    windowId = null, 
    grouped = false, 
    groupTitle = 'llm-burst',
    groupColor = DEFAULT_COLOR,
    active = true 
  } = options;

  try {
    const tabs = [];

    for (let i = 0; i < urls.length; i++) {
      const tab = await chrome.tabs.create({
        url: urls[i],
        windowId: windowId,
        active: active && i === 0
      });
      tabs.push(tab);
    }

    if (grouped && tabs.length > 0) {
      const tabIds = tabs.map((t) => t.id);
      const groupId = await addTabsToGroup(tabIds, null, {
        windowId: tabs[0].windowId,
        title: groupTitle,
        color: groupColor
      });

      return { tabs, groupId };
    }

    return { tabs, groupId: null };
  } catch (error) {
    console.error('Failed to open tabs:', error);
    throw error;
  }
}

// ============================================================================
// Window/Session Tracking (legacy maps)
// ============================================================================

function trackWindowSession(sessionId, windowId) {
  if (!sessionWindows.has(sessionId)) {
    sessionWindows.set(sessionId, new Set());
  }
  sessionWindows.get(sessionId).add(windowId);
  windowSessions.set(windowId, sessionId);

  chrome.storage.local.set({
    sessionWindows: Array.from(sessionWindows.entries()).map(([k, v]) => [k, Array.from(v)]),
    windowSessions: Array.from(windowSessions.entries())
  });
}

// ============================================================================
// Session Orchestration
// ============================================================================

/**
 * Ensure a provider tab exists for a session. Creates and groups it if missing.
 * Returns { tab, created, groupId }
 */
async function ensureProviderTab(sessionId, providerKey, options, title, activate = false) {
  const { sessions, tabIndex } = await loadState();
  const sess = sessions[sessionId];
  if (!sess) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const existing = sess.tabs?.[providerKey];
  if (existing) {
    try {
      const tab = await chrome.tabs.get(existing.tabId);
      return { tab, created: false, groupId: existing.groupId || null };
    } catch {
      // fall through to recreate
    }
  }

  // Create a new provider tab
  const url = getProviderUrl(providerKey, options || {});
  const tab = await chrome.tabs.create({ url, active: !!activate });

  // Group the tab
  const groupColor = PROVIDERS[providerKey]?.color || DEFAULT_COLOR;
  let groupId = await ensureTabGroup(tab.windowId, title, groupColor);
  if (groupId) {
    await chrome.tabs.group({ groupId, tabIds: [tab.id] });
  } else {
    groupId = await addTabsToGroup([tab.id], null, {
      windowId: tab.windowId,
      title,
      color: groupColor
    });
  }

  // Persist in sessions and tabIndex
  const updated = await updateState(async (state) => {
    const s = state.sessions[sessionId] || {
      id: sessionId,
      title,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      providers: [],
      options: options || {},
      tabs: {}
    };

    if (!s.providers.includes(providerKey)) {
      s.providers.push(providerKey);
    }
    s.tabs = s.tabs || {};
    s.tabs[providerKey] = {
      tabId: tab.id,
      windowId: tab.windowId,
      groupId,
      url,
      lastInjectAt: null
    };
    s.lastUsedAt = Date.now();

    state.sessions[sessionId] = s;
    state.tabIndex[tab.id] = { sessionId, provider: providerKey };
    if (!state.sessionOrder.includes(sessionId)) {
      state.sessionOrder.push(sessionId);
    }
    return state;
  });

  // Track window mapping (legacy)
  try {
    trackWindowSession(sessionId, tab.windowId);
  } catch (e) {
    console.warn('trackWindowSession failed:', e);
  }

  return { tab, created: true, groupId };
}

function isStructuredResponse(res) {
  return res && typeof res === 'object' && Object.prototype.hasOwnProperty.call(res, 'ok');
}

function normalizeGrokError({ code, state, message, error, details }, fallbackMessage) {
  return {
    ok: false,
    code: code || 'GROK_NOT_READY',
    state: state || 'unknown',
    message: message || error || fallbackMessage || 'Grok automation reported an unknown error',
    details: details ?? null
  };
}

async function waitForTabStatusComplete(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) return false;
      if (tab.status === 'complete') return true;
    } catch (error) {
      return false;
    }
    await delay(200);
  }
  return false;
}

async function waitForContentRouter(tabId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'llmburst-router-ping' });
      if (response && response.ok) return true;
    } catch (error) {
      const msg = String(error?.message || error);
      if (msg.includes('Receiving end does not exist') || msg.includes('No window with id')) {
        // content script not yet injected or tab closed; keep waiting
      } else {
        await delay(200);
      }
    }
    await delay(250);
  }
  return false;
}

async function probeGrokState(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const inspector = window.llmBurst?.inspectGrokState;
          if (typeof inspector === 'function') {
            return inspector();
          }
        } catch (error) {
          return { state: 'error', message: error?.message || String(error) };
        }
        return null;
      }
    });
    return result?.result ?? null;
  } catch (error) {
    return { state: 'error', message: error?.message || String(error) };
  }
}

async function reloadAndProbeGrok(tabId, { reason = 'unknown', timeoutMs = 12000 } = {}) {
  try {
    await chrome.tabs.reload(tabId, { bypassCache: true });
  } catch (error) {
    console.warn('[grok] reload failed:', error);
  }

  const loaded = await waitForTabStatusComplete(tabId, timeoutMs);
  if (!loaded) {
    return { state: 'hydration-timeout', message: 'Tab did not finish loading', reason };
  }

  const routerReady = await waitForContentRouter(tabId, timeoutMs);
  if (!routerReady) {
    return { state: 'hydration-timeout', message: 'Content router did not respond', reason };
  }

  const snapshot = await probeGrokState(tabId);
  if (!snapshot) {
    return { state: 'unknown', message: 'inspectGrokState unavailable', reason };
  }

  return {
    state: snapshot.state || 'unknown',
    message: snapshot.message || null,
    details: snapshot,
    reason
  };
}

async function recoverGrokViaCDP(tabId, { timeoutMs = 12000 } = {}) {
  let attached = false;
  try {
    try {
      await dbgAttach(tabId);
      attached = true;
    } catch (error) {
      if (error && /already attached/i.test(error.message || '')) {
        attached = true;
      } else {
        return { state: 'cdp-attach-failed', message: error?.message || String(error) };
      }
    }

    try { await dbgSend(tabId, 'Page.enable'); } catch {}
    try { await dbgSend(tabId, 'Runtime.enable'); } catch {}
    try { await dbgSend(tabId, 'Page.reload', { ignoreCache: true }); } catch {}

    const start = Date.now();
    let lastSnapshot = null;

    while (Date.now() - start < timeoutMs) {
      try {
        const snapshot = await dbgEval(tabId, `(() => {
          const inspector = window.llmBurst?.inspectGrokState;
          if (typeof inspector === 'function') {
            try { return inspector(); } catch (err) { return { state: 'error', message: err?.message || String(err) }; }
          }

          const composer = document.querySelector('textarea[aria-label="Ask Grok anything"], [contenteditable="true"][aria-label="Ask Grok anything"]');
          if (composer) return { state: 'ready' };

          if (document.querySelector('[data-cf-challenge], iframe[src*="challenges.cloudflare.com"]')) {
            return { state: 'cloudflare-block' };
          }

          const hasSignIn = Array.from(document.querySelectorAll('a, button, [role="button"]'))
            .some(el => /sign in/i.test((el.textContent || '').trim()));
          if (hasSignIn) return { state: 'login-required' };

          return { state: document.readyState === 'complete' ? 'unknown' : 'hydration-pending' };
        })();`);

        if (snapshot) {
          lastSnapshot = snapshot;
          if (snapshot.state === 'ready') {
            return { ok: true, state: 'ready', details: snapshot };
          }
          if (snapshot.state === 'login-required') {
            return { ok: false, state: 'login-required', details: snapshot };
          }
          if (snapshot.state === 'cloudflare-block') {
            await delay(600);
            continue;
          }
        }
      } catch (error) {
        lastSnapshot = { state: 'error', message: error?.message || String(error) };
      }

      await delay(400);
    }

    return { ok: false, state: 'timeout', details: lastSnapshot };
  } catch (error) {
    return { ok: false, state: 'error', message: error?.message || String(error) };
  } finally {
    if (attached) {
      try { await dbgDetach(tabId); } catch {}
    }
  }
}

async function handleGrokInjectionFailure(tabId, response, { attempt, maxAttempts }) {
  const state = response.state || 'unknown';
  const code = response.code || 'GROK_NOT_READY';

  if (code === 'GROK_LOGIN_REQUIRED' || state === 'login-required') {
    return normalizeGrokError(response, 'Grok requires an authenticated session.');
  }

  if (code !== 'GROK_NOT_READY' && state !== 'cloudflare-block' && state !== 'hydration-pending' && state !== 'unknown') {
    return normalizeGrokError(response);
  }

  const reloadProbe = await reloadAndProbeGrok(tabId, { reason: state });

  if (reloadProbe?.state === 'ready') {
    return 'retry';
  }

  if (reloadProbe?.state === 'login-required') {
    return normalizeGrokError(
      { code: 'GROK_LOGIN_REQUIRED', state: 'login-required', message: 'Sign-in required before using Grok.', details: reloadProbe },
      'Sign-in required before using Grok.'
    );
  }

  if (reloadProbe?.state === 'cloudflare-block') {
    const cdpProbe = await recoverGrokViaCDP(tabId, { timeoutMs: 15000 });
    if (cdpProbe?.state === 'ready' || cdpProbe?.ok) {
      return 'retry';
    }

    return normalizeGrokError(
      { code: 'GROK_CLOUDFLARE_BLOCK', state: 'cloudflare-block', message: 'Grok is blocked by Cloudflare Turnstile; manual verification likely required.', details: cdpProbe || reloadProbe },
      'Grok is blocked by Cloudflare Turnstile; manual verification likely required.'
    );
  }

  if (attempt < maxAttempts) {
    return 'retry';
  }

  return normalizeGrokError(
    { code: 'GROK_NOT_READY', state: reloadProbe?.state || state, message: reloadProbe?.message || response.message, details: reloadProbe },
    'Grok UI was not ready after recovery attempts.'
  );
}

/**
 * Send an injection request to a content script in a specific tab.
 * Payload: { mode: 'submit'|'followup', prompt: string, options?: { research?: boolean, incognito?: boolean } }
 */
async function injectIntoTab(tabId, providerKey, payload, timeoutMs = 15000) {
  const maxAttempts = providerKey === 'GROK' ? 3 : 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await withTimeout(
        chrome.tabs.sendMessage(tabId, {
          type: 'llmburst-inject',
          provider: providerKey,
          ...payload
        }),
        timeoutMs,
        'Injection timed out'
      );

      const normalized = isStructuredResponse(res)
        ? res
        : { ok: true, result: res ?? null };

      if (normalized.ok) {
        return normalized;
      }

      if (providerKey === 'GROK') {
        const outcome = await handleGrokInjectionFailure(tabId, normalized, { attempt, maxAttempts });
        if (outcome === 'retry') {
          continue;
        }
        if (outcome && typeof outcome === 'object') {
          return outcome;
        }
      }

      const errMsg = normalized.error || normalized.message || 'Unknown content response error';
      return { ok: false, error: errMsg };
    } catch (error) {
      const msg = String(error?.message || error);
      if (msg.includes('Could not establish connection') && attempt < maxAttempts) {
        await delay(500);
        continue;
      }
      if (providerKey === 'GROK') {
        return {
          ok: false,
          code: 'GROK_INJECT_ERROR',
          state: 'unknown',
          message: msg
        };
      }
      return { ok: false, error: msg };
    }
  }

  if (providerKey === 'GROK') {
    return {
      ok: false,
      code: 'GROK_INJECT_TIMEOUT',
      state: 'unknown',
      message: 'Injection failed after retries'
    };
  }

  return { ok: false, error: 'Injection failed after retries' };
}

/**
 * Start a new session: open tabs for providers, group them, and inject the prompt.
 */
async function handleNewSession(sessionId, title, providers, prompt, options) {
  const normalizedProviders = (providers || []).filter((p) => PROVIDER_KEYS.includes(p));
  if (normalizedProviders.length === 0) {
    throw new Error('No valid providers specified');
  }
  const finalTitle = sanitizeTitle(title) || 'llm-burst';

  // Create or seed the session
  await updateState(async (state) => {
    if (!state.sessions[sessionId]) {
      state.sessions[sessionId] = {
        id: sessionId,
        title: finalTitle,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        providers: [...normalizedProviders],
        options: { research: !!options?.research, incognito: !!options?.incognito },
        tabs: {}
      };
      if (!state.sessionOrder.includes(sessionId)) {
        state.sessionOrder.push(sessionId);
      }
    }
    return state;
  });

  // Open provider tabs (first one active)
  const openResults = {};
  for (let i = 0; i < normalizedProviders.length; i++) {
    const provider = normalizedProviders[i];
    const { tab, created, groupId } = await ensureProviderTab(
      sessionId,
      provider,
      options,
      finalTitle,
      i === 0
    );
    openResults[provider] = { tabId: tab.id, windowId: tab.windowId, groupId: groupId || null, created };
  }

  // Inject prompt (submit) to each provider tab
  const injections = {};
  await Promise.all(
    normalizedProviders.map(async (provider) => {
      const tabId = openResults[provider].tabId;
      const res = await injectIntoTab(tabId, provider, {
        mode: 'submit',
        prompt,
        options: { research: !!options?.research, incognito: !!options?.incognito }
      });
      injections[provider] = res;
      if (res.ok) {
        await updateState(async (state) => {
          const sess = state.sessions[sessionId];
          if (sess && sess.tabs[provider]) {
            sess.tabs[provider].lastInjectAt = Date.now();
          }
          sess.lastUsedAt = Date.now();
          return state;
        });
      }
    })
  );

  return {
    sessionId,
    title: finalTitle,
    tabs: openResults,
    injections
  };
}

/**
 * Send a follow-up prompt to an existing session's tabs.
 */
async function handleFollowUp(sessionId, prompt) {
  const { sessions } = await loadState();
  const sess = sessions[sessionId];
  if (!sess) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const providers = sess.providers || [];
  const results = {};
  for (const provider of providers) {
    // Ensure tab exists (recreate if needed)
    const ensured = await ensureProviderTab(sessionId, provider, sess.options, sess.title, false);
    const tabId = ensured.tab.id;
    const res = await injectIntoTab(tabId, provider, { mode: 'followup', prompt });
    results[provider] = res;
    if (res.ok) {
      await updateState(async (state) => {
        const s = state.sessions[sessionId];
        if (s && s.tabs[provider]) {
          s.tabs[provider].lastInjectAt = Date.now();
        }
        s.lastUsedAt = Date.now();
        return state;
      });
    }
  }

  return { sessionId, injected: Object.keys(results).filter((p) => results[p].ok), results };
}

/**
 * Delete a session and optionally close its tabs.
 */
async function deleteSession(sessionId, closeTabs = false) {
  const { sessions } = await loadState();
  const sess = sessions[sessionId];
  if (!sess) return { ok: true, deleted: false };

  if (closeTabs) {
    const tabIds = Object.values(sess.tabs || {}).map((t) => t.tabId);
    for (const id of tabIds) {
      try {
        await chrome.tabs.remove(id);
      } catch {
        // ignore
      }
    }
  }

  await updateState(async (state) => {
    // Remove tabIndex entries
    for (const [tabId, idx] of Object.entries(state.tabIndex)) {
      if (idx.sessionId === sessionId) {
        delete state.tabIndex[tabId];
      }
    }
    delete state.sessions[sessionId];
    state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
    return state;
  });

  // Remove legacy window maps
  const wins = sessionWindows.get(sessionId);
  if (wins) {
    for (const wid of wins) {
      if (windowSessions.get(wid) === sessionId) {
        windowSessions.delete(wid);
      }
    }
  }
  sessionWindows.delete(sessionId);
  await chrome.storage.local.set({
    sessionWindows: Array.from(sessionWindows.entries()).map(([k, v]) => [k, Array.from(v)]),
    windowSessions: Array.from(windowSessions.entries())
  });

  return { ok: true, deleted: true };
}

/**
 * Prune sessions by removing entries for tabs that no longer exist.
 */
async function pruneSessions() {
  const state = await loadState();
  let pruned = 0;

  for (const [sessionId, sess] of Object.entries(state.sessions)) {
    const providers = Object.keys(sess.tabs || {});
    for (const provider of providers) {
      const info = sess.tabs[provider];
      try {
        await chrome.tabs.get(info.tabId);
      } catch {
        // Tab gone - remove mapping
        delete sess.tabs[provider];
        delete state.tabIndex[info.tabId];
        pruned += 1;
      }
    }
    // Remove empty sessions
    if (Object.keys(sess.tabs || {}).length === 0) {
      delete state.sessions[sessionId];
      state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      pruned += 1;
    }
  }

  await saveState(state);
  return pruned;
}

// ============================================================================
// Auto-Naming via Gemini API (chrome.storage.sync for creds)
// ============================================================================

async function autoNamePrompt(text, { timeoutMs = 15000, modelOverride } = {}) {
  const { geminiApiKey = '', geminiModel = '' } = await chrome.storage.sync.get([
    'geminiApiKey',
    'geminiModel'
  ]);
  const apiKey = (geminiApiKey || '').trim();
  if (!apiKey) {
    console.warn('[llm-burst] Auto-naming failed: No Gemini API key configured');
    return { ok: false, error: 'No Gemini API key configured in Options' };
  }
  // Normalize model name - ensure it has "models/" prefix
  let model = (modelOverride || geminiModel || 'models/gemini-2.5-flash-lite').trim();
  if (!model.startsWith('models/')) {
    model = 'models/' + model;
  }
  console.log('[llm-burst] Auto-naming with model:', model);

  const prompt = [
    'Propose a short, distinctive tab‑group title for this conversation.',
    'Aim for 1–3 words (ideally two); go longer only if needed to clearly disambiguate from similar topics.',
    'Use Title Case. No emojis, brackets, quotes, code fences, or trailing punctuation.',
    'Include a concrete qualifier when helpful (e.g., product, jurisdiction, framework, year).',
    'Avoid generic labels (Chat, Notes, Draft, Brainstorm). Prefer a title that reads well in a browser tab; ≤ 24 characters when reasonable.',
    '',
    'Return only the title text.',
    '',
    String(text).slice(0, 10000) // cap input size
  ].join('\n');

  // Build URL with proper model path - don't encode the forward slash in "models/"
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 40
        }
      })
    });
    clearTimeout(t);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const errorMsg = `Gemini API error: ${resp.status} ${resp.statusText} ${errText}`.trim();
      console.error('[llm-burst] Auto-naming API error:', errorMsg);
      return { ok: false, error: errorMsg };
    }

    const data = await resp.json();
    console.log('[llm-burst] Auto-naming API response:', data);
    
    const textOut =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.output ||
      '';

    const title = sanitizeTitle(textOut);
    if (!title) {
      console.warn('[llm-burst] Auto-naming failed: Empty title from API');
      return { ok: false, error: 'No title returned by Gemini API' };
    }
    console.log('[llm-burst] Auto-naming successful:', title);
    return { ok: true, title };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Auto-naming timed out' : (e?.message || String(e));
    console.error('[llm-burst] Auto-naming exception:', msg, e);
    return { ok: false, error: msg };
  }
}

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const { type, ...params } = message || {};

      switch (type) {
        // -------------------------------------------------------------------
        // Basic ping (content.js bridge compatibility)
        // -------------------------------------------------------------------
        case 'llmburst-ping': {
          sendResponse({ ok: true, version: EXTENSION_VERSION });
          break;
        }

        // -------------------------------------------------------------------
        // ChatGPT: Enable Research via CDP trusted clicks
        // -------------------------------------------------------------------
        case 'llmburst-chatgpt-enable-research': {
          const tabId = sender?.tab?.id || params.tabId;
          if (!tabId) {
            sendResponse({ ok: false, error: 'No tabId available to debug' });
            break;
          }
          try {
            const result = await enableChatGPTResearchViaCDP(tabId, { timeoutMs: params.timeoutMs || 6000 });
            sendResponse({ ok: result.ok, activated: !!result.activated, error: result.error || null });
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
          break;
        }

        // -------------------------------------------------------------------
        // New Session API (for popup)
        // -------------------------------------------------------------------
        case 'llmburst-get-sessions': {
          const { sessions, sessionOrder } = await loadState();
          sendResponse({ ok: true, sessions, order: sessionOrder });
          break;
        }

        case 'llmburst-start-new-session': {
          const { title = 'llm-burst', providers = [], prompt = '', options = {} } = params;
          if (!prompt || String(prompt).trim().length === 0) {
            sendResponse({ ok: false, error: 'Prompt is required' });
            break;
          }
          if (!Array.isArray(providers) || providers.length === 0) {
            sendResponse({ ok: false, error: 'At least one provider is required' });
            break;
          }
          const sessionId = generateSessionId();
          try {
            const result = await handleNewSession(sessionId, title, providers, prompt, options);
            sendResponse({ ok: true, ...result });
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
          break;
        }

        case 'llmburst-follow-up': {
          const { sessionId, prompt = '' } = params;
          if (!sessionId) {
            sendResponse({ ok: false, error: 'sessionId is required' });
            break;
          }
          if (!prompt || String(prompt).trim().length === 0) {
            sendResponse({ ok: false, error: 'Prompt is required' });
            break;
          }
          try {
            const result = await handleFollowUp(sessionId, prompt);
            sendResponse({ ok: true, ...result });
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
          break;
        }

        case 'llmburst-delete-session': {
          const { sessionId, closeTabs = false } = params;
          if (!sessionId) {
            sendResponse({ ok: false, error: 'sessionId is required' });
            break;
          }
          const result = await deleteSession(sessionId, !!closeTabs);
          sendResponse({ ok: true, ...result });
          break;
        }

        case 'llmburst-prune-sessions': {
          const prunedCount = await pruneSessions();
          sendResponse({ ok: true, prunedCount });
          break;
        }

        case 'llmburst-autoname': {
          const { text = '', timeoutMs = 15000, model } = params;
          if (!text || String(text).trim().length === 0) {
            sendResponse({ ok: false, error: 'Text is required' });
            break;
          }
          const res = await autoNamePrompt(text, { timeoutMs, modelOverride: model });
          sendResponse(res);
          break;
        }

        // -------------------------------------------------------------------
        // Legacy helpers (kept for compatibility with existing content bridge)
        // -------------------------------------------------------------------
        case 'llmburst-group': {
          if (!sender?.tab) throw new Error('No sender tab');

          const title = params.title || 'llm-burst';
          const color = params.color || DEFAULT_COLOR;
          let groupId = await ensureTabGroup(sender.tab.windowId, title, color);

          if (groupId) {
            await chrome.tabs.group({ groupId, tabIds: [sender.tab.id] });
          } else {
            groupId = await chrome.tabs.group({ 
              tabIds: [sender.tab.id],
              createProperties: { windowId: sender.tab.windowId }
            });
            await chrome.tabGroups.update(groupId, { 
              title,
              color: ALLOWED_COLORS.has(color) ? color : DEFAULT_COLOR,
              collapsed: false 
            });
          }

          if (params.sessionId) {
            trackWindowSession(params.sessionId, sender.tab.windowId);
          }

          sendResponse({ ok: true, groupId, tabId: sender.tab.id });
          break;
        }

        case 'llmburst-open-tabs': {
          const result = await openTabs(params.urls || [], {
            windowId: params.windowId,
            grouped: params.grouped !== false,
            groupTitle: params.groupTitle,
            groupColor: params.groupColor,
            active: params.active !== false
          });

          if (params.sessionId && result.tabs.length > 0) {
            trackWindowSession(params.sessionId, result.tabs[0].windowId);
          }

          sendResponse({ 
            ok: true, 
            tabs: result.tabs.map((t) => ({ id: t.id, windowId: t.windowId, url: t.url })),
            groupId: result.groupId 
          });
          break;
        }

        case 'llmburst-create-group': {
          const newGroupId = await addTabsToGroup(params.tabIds || [], null, {
            windowId: params.windowId,
            title: params.title || 'llm-burst',
            color: params.color || DEFAULT_COLOR
          });

          sendResponse({ ok: true, groupId: newGroupId });
          break;
        }

        case 'llmburst-combine-windows': {
          const combineResult = await combineWindows(params.sessionId, params.targetWindowId);
          sendResponse({ 
            ok: true, 
            targetWindowId: combineResult.targetWindowId,
            movedTabs: combineResult.movedTabs
          });
          break;
        }

        case 'llmburst-session-info': {
          const sessionId = params.sessionId;
          const windows = sessionWindows.get(sessionId) || new Set();
          sendResponse({ 
            ok: true, 
            sessionId,
            windows: Array.from(windows)
          });
          break;
        }

        default: {
          sendResponse({ ok: false, error: `Unknown message type: ${type}` });
        }
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ 
        ok: false, 
        error: error?.message || String(error)
      });
    }
  })();

  return true; // Keep message channel open for async response
});

// ============================================================================
// Legacy: Combine windows (group tabs by original window into target window)
// ============================================================================

async function combineWindows(sessionId, targetWindowId = null) {
  try {
    const windowIds = sessionWindows.get(sessionId);
    if (!windowIds || windowIds.size === 0) {
      throw new Error(`No windows found for session ${sessionId}`);
    }

    if (!targetWindowId) {
      let maxTabs = 0;
      for (const winId of windowIds) {
        try {
          const tabs = await chrome.tabs.query({ windowId: winId });
          if (tabs.length > maxTabs) {
            maxTabs = tabs.length;
            targetWindowId = winId;
          }
        } catch (e) {
          windowIds.delete(winId);
        }
      }
    }

    if (!targetWindowId) {
      throw new Error('No valid target window found');
    }

    const movedTabs = [];
    for (const winId of windowIds) {
      if (winId === targetWindowId) continue;

      try {
        const tabs = await chrome.tabs.query({ windowId: winId });
        if (tabs.length > 0) {
          const tabIds = tabs.map((t) => t.id);
          await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
          movedTabs.push(...tabIds);

          await addTabsToGroup(tabIds, null, {
            windowId: targetWindowId,
            title: `Window ${winId}`,
            color: DEFAULT_COLOR
          });
        }
      } catch (e) {
        console.error(`Failed to move tabs from window ${winId}:`, e);
      }
    }

    await chrome.windows.update(targetWindowId, { focused: true });

    return { targetWindowId, movedTabs: movedTabs.length };
  } catch (error) {
    console.error('Failed to combine windows:', error);
    throw error;
  }
}

// ============================================================================
// Initialization & Event Hooks
// ============================================================================

chrome.runtime.onStartup.addListener(async () => {
  try {
    const data = await chrome.storage.local.get([
      'sessionWindows',
      'windowSessions',
      'sessions',
      'tabIndex',
      'sessionOrder'
    ]);

    // Restore legacy maps
    if (data.sessionWindows) {
      for (const [sessionId, windowIds] of data.sessionWindows) {
        sessionWindows.set(sessionId, new Set(windowIds));
      }
    }
    if (data.windowSessions) {
      for (const [windowId, sessionId] of data.windowSessions) {
        windowSessions.set(windowId, sessionId);
      }
    }

    // Prune sessions on startup
    const pruned = await pruneSessions();

    console.log('LLM Burst Helper initialized', {
      sessions: Object.keys(data.sessions || {}).length,
      windows: windowSessions.size,
      pruned
    });
  } catch (error) {
    console.error('Failed to restore session data:', error);
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const sessionId = windowSessions.get(windowId);
  if (sessionId) {
    windowSessions.delete(windowId);
    const sessionsSet = sessionWindows.get(sessionId);
    if (sessionsSet) {
      sessionsSet.delete(windowId);
      if (sessionsSet.size === 0) {
        sessionWindows.delete(sessionId);
      }
    }
    await chrome.storage.local.set({
      sessionWindows: Array.from(sessionWindows.entries()).map(([k, v]) => [k, Array.from(v)]),
      windowSessions: Array.from(windowSessions.entries())
    });
  }

  // Additionally, remove any session tabs that belonged to this window
  await updateState(async (state) => {
    for (const [sid, sess] of Object.entries(state.sessions)) {
      const providers = Object.keys(sess.tabs || {});
      for (const provider of providers) {
        const info = sess.tabs[provider];
        if (info.windowId === windowId) {
          delete sess.tabs[provider];
          delete state.tabIndex[info.tabId];
        }
      }
      if (Object.keys(sess.tabs || {}).length === 0) {
        delete state.sessions[sid];
        state.sessionOrder = state.sessionOrder.filter((id) => id !== sid);
      }
    }
    return state;
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Remove mappings for this tab
  await updateState(async (state) => {
    const idx = state.tabIndex[tabId];
    if (idx) {
      const { sessionId, provider } = idx;
      const sess = state.sessions[sessionId];
      if (sess && sess.tabs && sess.tabs[provider] && sess.tabs[provider].tabId === tabId) {
        delete sess.tabs[provider];
      }
      delete state.tabIndex[tabId];
      if (sess && Object.keys(sess.tabs || {}).length === 0) {
        delete state.sessions[sessionId];
        state.sessionOrder = state.sessionOrder.filter((id) => id !== sessionId);
      }
    }
    return state;
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    await updateState(async (state) => {
      const idx = state.tabIndex[tabId];
      if (idx) {
        const sess = state.sessions[idx.sessionId];
        if (sess && sess.tabs[idx.provider]) {
          sess.tabs[idx.provider].url = changeInfo.url;
        }
      }
      return state;
    });
  }
});

console.log('LLM Burst Helper background service worker loaded');

// =============================================================================
// Commands (keyboard shortcuts)
// =============================================================================

chrome.commands.onCommand.addListener(async (command) => {
  try {
    switch (command) {
      case 'open_launcher': {
        await chrome.windows.create({
          url: chrome.runtime.getURL('launcher.html'),
          type: 'popup', width: 420, height: 640
        });
        break;
      }
      default:
        // _execute_action is handled by Chrome automatically
        break;
    }
  } catch (e) {
    console.error('Command handling failed:', command, e);
  }
});
