/**
 * LLM Burst Helper Extension - Background Service Worker
 * Provides tab grouping, window management, and session tracking for llm-burst
 */

// ============================================================================
// Constants
// ============================================================================

const ALLOWED_COLORS = new Set([
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'
]);

const DEFAULT_COLOR = 'blue';
const EXTENSION_VERSION = '1.0.0';

// Session tracking for window relationships
const sessionWindows = new Map(); // sessionId -> Set<windowId>
const windowSessions = new Map(); // windowId -> sessionId

// ============================================================================
// Tab Group Management
// ============================================================================

/**
 * Find or create a tab group with the given title in a window
 */
async function ensureTabGroup(windowId, title, color = DEFAULT_COLOR) {
  try {
    // Normalize inputs
    const groupTitle = String(title || 'llm-burst').slice(0, 80);
    const groupColor = ALLOWED_COLORS.has(color) ? color : DEFAULT_COLOR;
    
    // Check for existing group with this title in the window
    const existingGroups = await chrome.tabGroups.query({ title: groupTitle, windowId });
    
    if (existingGroups && existingGroups.length > 0) {
      // Update color if different
      const group = existingGroups[0];
      if (group.color !== groupColor) {
        await chrome.tabGroups.update(group.id, { color: groupColor });
      }
      return group.id;
    }
    
    // Cannot create an empty group - will be created when first tab is added
    // Return a special marker to indicate group should be created
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
      // Add to existing group
      await chrome.tabs.group({ groupId, tabIds });
    } else {
      // Create new group with tabs
      const newGroupId = await chrome.tabs.group({ 
        tabIds,
        createProperties: groupOptions.windowId ? { windowId: groupOptions.windowId } : {}
      });
      
      // Configure the new group if options provided
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
// Tab Management
// ============================================================================

/**
 * Open multiple URLs in new tabs
 */
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
    
    // Create tabs
    for (let i = 0; i < urls.length; i++) {
      const tab = await chrome.tabs.create({
        url: urls[i],
        windowId: windowId,
        active: active && i === 0 // Only first tab is active
      });
      tabs.push(tab);
    }
    
    // Group tabs if requested
    if (grouped && tabs.length > 0) {
      const tabIds = tabs.map(t => t.id);
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
// Window Management
// ============================================================================

/**
 * Track windows as part of a session
 */
function trackWindowSession(sessionId, windowId) {
  if (!sessionWindows.has(sessionId)) {
    sessionWindows.set(sessionId, new Set());
  }
  sessionWindows.get(sessionId).add(windowId);
  windowSessions.set(windowId, sessionId);
  
  // Persist to storage
  chrome.storage.local.set({
    sessionWindows: Array.from(sessionWindows.entries()).map(([k, v]) => [k, Array.from(v)]),
    windowSessions: Array.from(windowSessions.entries())
  });
}

/**
 * Combine multiple windows into tab groups in the target window
 */
async function combineWindows(sessionId, targetWindowId = null) {
  try {
    const windowIds = sessionWindows.get(sessionId);
    if (!windowIds || windowIds.size === 0) {
      throw new Error(`No windows found for session ${sessionId}`);
    }
    
    // Find target window (most tabs or specified)
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
          // Window might be closed
          windowIds.delete(winId);
        }
      }
    }
    
    if (!targetWindowId) {
      throw new Error('No valid target window found');
    }
    
    // Move tabs from other windows to target
    const movedTabs = [];
    for (const winId of windowIds) {
      if (winId === targetWindowId) continue;
      
      try {
        const tabs = await chrome.tabs.query({ windowId: winId });
        if (tabs.length > 0) {
          const tabIds = tabs.map(t => t.id);
          await chrome.tabs.move(tabIds, { windowId: targetWindowId, index: -1 });
          movedTabs.push(...tabIds);
          
          // Group the moved tabs by their original window
          const groupId = await addTabsToGroup(tabIds, null, {
            windowId: targetWindowId,
            title: `Window ${winId}`,
            color: DEFAULT_COLOR
          });
        }
      } catch (e) {
        console.error(`Failed to move tabs from window ${winId}:`, e);
      }
    }
    
    // Focus the target window
    await chrome.windows.update(targetWindowId, { focused: true });
    
    return { targetWindowId, movedTabs: movedTabs.length };
  } catch (error) {
    console.error('Failed to combine windows:', error);
    throw error;
  }
}

// ============================================================================
// Message Handling
// ============================================================================

/**
 * Process messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Run async handler
  (async () => {
    try {
      const { type, ...params } = message;
      
      switch (type) {
        // Ping to check extension presence
        case 'llmburst-ping':
          sendResponse({ ok: true, version: EXTENSION_VERSION });
          break;
          
        // Add current tab to a group
        case 'llmburst-group':
          if (!sender?.tab) {
            throw new Error('No sender tab');
          }
          
          const title = params.title || 'llm-burst';
          const color = params.color || DEFAULT_COLOR;
          let groupId = await ensureTabGroup(
            sender.tab.windowId,
            title,
            color
          );
          
          if (groupId) {
            // Add to existing group
            await chrome.tabs.group({ 
              groupId, 
              tabIds: [sender.tab.id] 
            });
          } else {
            // Create new group with this tab
            groupId = await chrome.tabs.group({ 
              tabIds: [sender.tab.id],
              createProperties: { windowId: sender.tab.windowId }
            });
            
            // Configure the group
            await chrome.tabGroups.update(groupId, { 
              title: title, 
              color: ALLOWED_COLORS.has(color) ? color : DEFAULT_COLOR,
              collapsed: false 
            });
          }
          
          // Track session if provided
          if (params.sessionId) {
            trackWindowSession(params.sessionId, sender.tab.windowId);
          }
          
          sendResponse({ ok: true, groupId, tabId: sender.tab.id });
          break;
          
        // Open new tabs with URLs
        case 'llmburst-open-tabs':
          const result = await openTabs(params.urls || [], {
            windowId: params.windowId,
            grouped: params.grouped !== false,
            groupTitle: params.groupTitle,
            groupColor: params.groupColor,
            active: params.active !== false
          });
          
          // Track session if provided
          if (params.sessionId && result.tabs.length > 0) {
            trackWindowSession(params.sessionId, result.tabs[0].windowId);
          }
          
          sendResponse({ 
            ok: true, 
            tabs: result.tabs.map(t => ({ id: t.id, windowId: t.windowId, url: t.url })),
            groupId: result.groupId 
          });
          break;
          
        // Create a tab group with specific tabs
        case 'llmburst-create-group':
          const newGroupId = await addTabsToGroup(
            params.tabIds || [],
            null,
            {
              windowId: params.windowId,
              title: params.title || 'llm-burst',
              color: params.color || DEFAULT_COLOR
            }
          );
          
          sendResponse({ ok: true, groupId: newGroupId });
          break;
          
        // Combine windows for a session
        case 'llmburst-combine-windows':
          const combineResult = await combineWindows(
            params.sessionId,
            params.targetWindowId
          );
          
          sendResponse({ 
            ok: true, 
            targetWindowId: combineResult.targetWindowId,
            movedTabs: combineResult.movedTabs
          });
          break;
          
        // Get session info
        case 'llmburst-session-info':
          const sessionId = params.sessionId;
          const windows = sessionWindows.get(sessionId) || new Set();
          
          sendResponse({ 
            ok: true, 
            sessionId,
            windows: Array.from(windows)
          });
          break;
          
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${type}` });
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ 
        ok: false, 
        error: error.message || String(error) 
      });
    }
  })();
  
  return true; // Keep message channel open for async response
});

// ============================================================================
// Initialization
// ============================================================================

/**
 * Restore session tracking from storage on startup
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    const data = await chrome.storage.local.get(['sessionWindows', 'windowSessions']);
    
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
    
    console.log('LLM Burst Helper initialized', {
      sessions: sessionWindows.size,
      windows: windowSessions.size
    });
  } catch (error) {
    console.error('Failed to restore session data:', error);
  }
});

// Clean up closed windows
chrome.windows.onRemoved.addListener((windowId) => {
  const sessionId = windowSessions.get(windowId);
  if (sessionId) {
    windowSessions.delete(windowId);
    const sessions = sessionWindows.get(sessionId);
    if (sessions) {
      sessions.delete(windowId);
      if (sessions.size === 0) {
        sessionWindows.delete(sessionId);
      }
    }
  }
});

console.log('LLM Burst Helper background service worker loaded');