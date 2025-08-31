export function renderApp({ mode = 'popup' }) {
  const isLauncher = mode === 'launcher';
  
  // Create the HTML structure
  const html = `
    ${isLauncher ? '<div class="launcher-wrapper">' : ''}
    <header class="header">
      <div class="title">LLM Burst${isLauncher ? ' Launcher' : ''}</div>
      <button id="openOptions" class="icon-button" title="Options" aria-label="Options">
        ⚙️
      </button>
    </header>

    <main class="container">
      <section class="section">
        <div class="row" style="align-items: center; justify-content: space-between;">
          <label for="prompt" class="label">Prompt</label>
          <div style="display: flex; gap: 8px;">
            <button id="clearBtn" type="button" class="icon-button" title="Clear text" style="padding: 4px 8px; font-size: 12px; display: none;">✕ Clear</button>
            <button id="pasteBtn" type="button" class="icon-button" title="Paste from clipboard" style="padding: 4px 8px; font-size: 12px;">📋 Paste</button>
          </div>
        </div>
        <textarea id="prompt" class="textarea" rows="8" placeholder="Paste or type your prompt..."${isLauncher ? ' autofocus' : ''}></textarea>
        <div class="hint" id="promptHint">Tip: Press <span id="shortcutKey">Cmd+Enter</span> to send • Drafts auto-save</div>
      </section>

      <section class="section options">
        <div class="checkbox-row">
          <label class="checkbox">
            <input type="checkbox" id="research">
            <span>Research</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="incognito">
            <span>Incognito</span>
          </label>
        </div>
      </section>

      <section class="section providers">
        <div class="providers-header">Providers</div>
        <div class="providers-grid">
          <label class="checkbox">
            <input type="checkbox" id="prov-chatgpt" data-provider="CHATGPT" checked>
            <span>ChatGPT</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="prov-claude" data-provider="CLAUDE" checked>
            <span>Claude</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="prov-gemini" data-provider="GEMINI" checked>
            <span>Gemini</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" id="prov-grok" data-provider="GROK" checked>
            <span>Grok</span>
          </label>
        </div>
      </section>

      <section class="section">
        <div class="row">
          <label for="sessionSelect" class="label">Session</label>
          <select id="sessionSelect" class="select">
            <option value="__new__">New conversation</option>
          </select>
        </div>
      </section>

      <section class="section" id="newSessionFields">
        <label for="groupTitle" class="label">Group title</label>
        <div class="group-title-row">
          <input id="groupTitle" class="input" type="text" maxlength="80" placeholder="Conversation title">
          <div id="autonameSpinner" class="spinner" hidden title="Auto-naming..."></div>
        </div>
        <div class="hint">Title auto-fills from your prompt using Gemini (if configured). You can edit anytime.</div>
      </section>

      <div id="status" class="status" role="status" aria-live="polite"></div>

      <section class="section actions">
        <button id="sendButton" class="button primary">Send</button>
      </section>
    </main>

    <footer class="footer">
      <span class="muted">Tip: Set your Gemini API key in Options for auto-naming</span>
    </footer>
    ${isLauncher ? '</div>' : ''}
  `;

  // Insert the HTML into the body
  document.body.innerHTML = html;
  
  // Add launcher-specific styles if needed
  if (isLauncher) {
    // These styles override popup constraints for the launcher page
    const style = document.createElement('style');
    style.textContent = `
      html, body {
        width: 100% !important;
        min-height: 100vh !important;
      }
      body {
        display: flex;
        justify-content: center;
        align-items: center;
        background: #0f1115;
        padding: 20px;
      }
      .launcher-wrapper {
        width: 100%;
        max-width: 400px;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      }
    `;
    document.head.appendChild(style);
  }
}

// Auto-detect mode based on the page URL
export function detectMode() {
  return window.location.pathname.includes('launcher') ? 'launcher' : 'popup';
}