type ResearchState = 'closed' | 'open-disabled' | 'open-enabled';
type ClaudeFixtureVariant = 'legacy' | 'lexical' | 'sonnet45';
type ContentEditableMode = 'true' | 'plaintext-only';

export interface ClaudeFixtureOptions {
  variant?: ClaudeFixtureVariant;
  includeHiddenEditor?: boolean;
  researchState?: ResearchState;
  incognitoButton?: boolean;
  incognitoRemountsEditor?: boolean;
  contentEditableMode?: ContentEditableMode;
}

const defaultOptions: Required<Omit<ClaudeFixtureOptions, 'variant'>> & { variant: ClaudeFixtureVariant } = {
  variant: 'legacy',
  includeHiddenEditor: false,
  researchState: 'closed',
  incognitoButton: false,
  incognitoRemountsEditor: false,
  contentEditableMode: 'true',
};

function renderLegacyResearchMenu(state: ResearchState): string {
  const expanded = state !== 'closed';
  const enabled = state === 'open-enabled';
  return `
    <div class="toolbar">
      <button id="tools-trigger" type="button" aria-label="Open tools menu" aria-expanded="${expanded}">
        <span>Tools</span>
      </button>
      <div id="tools-menu" role="menu"${expanded ? '' : ' hidden'}>
        <button
          id="research-toggle"
          type="button"
          aria-label="Research"
          aria-pressed="${enabled}"
          data-state="${enabled ? 'on' : 'off'}"
        >
          <span>Research</span>
          <input type="checkbox" role="switch" ${enabled ? 'checked' : ''} />
        </button>
      </div>
    </div>
  `;
}

function renderLegacyIncognitoButton(includeButton: boolean): string {
  if (!includeButton) return '';
  return `
    <button
      id="incognito-toggle"
      type="button"
      aria-label="Start incognito chat"
      data-testid="composer-incognito-toggle"
      data-state="inactive"
    >
      <span>Incognito</span>
      <svg><title>look-around</title></svg>
    </button>
  `;
}

function renderLegacyFixture(options: Required<ClaudeFixtureOptions>): string {
  const { includeHiddenEditor, researchState, incognitoButton, incognitoRemountsEditor } = options;
  const editableMode = options.contentEditableMode === 'plaintext-only' ? 'plaintext-only' : 'true';
  const hiddenEditor = includeHiddenEditor
    ? `<div class="ProseMirror" style="display:none" contenteditable="${editableMode}"></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Claude Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; }
      .ProseMirror { border: 1px solid #ccc; min-height: 120px; padding: 8px; }
      #send-button[aria-disabled="true"] { opacity: 0.4; }
      #tools-menu[hidden] { display: none; }
      header { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
    </style>
  </head>
  <body data-variant="legacy">
    ${hiddenEditor}
    <header>
      ${renderLegacyResearchMenu(researchState)}
      ${renderLegacyIncognitoButton(incognitoButton)}
      <button id="send-button" type="button" data-testid="send-button" aria-label="Send message" aria-disabled="true" disabled>
        <span>Send</span>
      </button>
    </header>
    <main>
      <div class="ProseMirror" data-editor-id="composer-1" contenteditable="${editableMode}"><p><br /></p></div>
    </main>
    <script type="module">
      const sendButton = document.getElementById('send-button');
      const toolsTrigger = document.getElementById('tools-trigger');
      const toolsMenu = document.getElementById('tools-menu');
      const researchToggle = document.getElementById('research-toggle');
      const incognitoToggle = document.getElementById('incognito-toggle');

      window.__sendClicks = 0;
      window.__researchEnabled = researchToggle ? researchToggle.getAttribute('data-state') === 'on' : false;
      window.__incognitoActive = false;
      window.__incognitoClicks = 0;
      window.__lastComposerHtml = '';
      window.__editorRemounted = false;
      window.__activeEditorId = 'composer-1';

      const attachEditor = (editor) => {
        if (!editor) return;
        const enableSend = () => {
          sendButton.removeAttribute('disabled');
          sendButton.setAttribute('aria-disabled', 'false');
        };
        editor.addEventListener('input', () => {
          window.__activeEditorId = editor.getAttribute('data-editor-id') || 'unknown';
          window.__lastComposerHtml = editor.innerHTML;
          setTimeout(enableSend, 50);
        });
      };

      const initialEditor = document.querySelector('.ProseMirror[data-editor-id="composer-1"]');
      attachEditor(initialEditor);

      sendButton.addEventListener('click', () => {
        window.__sendClicks += 1;
      const activeEditor = document.querySelector('.ProseMirror[contenteditable]:not([style*="display:none"])');
        if (activeEditor) {
          window.__lastComposerHtml = activeEditor.innerHTML;
        }
      });

      if (toolsTrigger && toolsMenu) {
        const setExpanded = (expanded) => {
          toolsTrigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          toolsMenu.hidden = !expanded;
        };
        setExpanded(${researchState !== 'closed'});
        toolsTrigger.addEventListener('click', () => {
          const current = toolsTrigger.getAttribute('aria-expanded') === 'true';
          setExpanded(!current);
        });
      }

      if (researchToggle) {
        researchToggle.addEventListener('click', () => {
          const input = researchToggle.querySelector('input');
          const next = !(input && input.checked);
          if (input) input.checked = next;
          researchToggle.setAttribute('data-state', next ? 'on' : 'off');
          researchToggle.setAttribute('aria-pressed', next ? 'true' : 'false');
          window.__researchEnabled = next;
        });
      }

      if (incognitoToggle) {
        incognitoToggle.addEventListener('click', () => {
          window.__incognitoClicks += 1;
          incognitoToggle.setAttribute('aria-pressed', 'true');
          incognitoToggle.setAttribute('data-state', 'active');
          document.body.dataset.incognito = 'active';
          try {
            history.replaceState(null, '', '?incognito=1');
          } catch {
            // ignore history errors in fixture
          }
          window.__incognitoActive = true;

          if (${incognitoRemountsEditor}) {
            const current = document.querySelector('.ProseMirror[data-editor-id="composer-1"]');
            if (current) {
              const replacement = current.cloneNode(false);
              replacement.setAttribute('data-editor-id', 'composer-2');
              replacement.innerHTML = '<p><br /></p>';
              current.replaceWith(replacement);
              window.__editorRemounted = true;
              attachEditor(replacement);
            }
          }
        });
      }
    </script>
  </body>
</html>`;
}

function renderLexicalFixture(options: Required<ClaudeFixtureOptions>): string {
  const { researchState, incognitoRemountsEditor } = options;
  const editableMode = options.contentEditableMode === 'plaintext-only' ? 'plaintext-only' : 'true';
  const initialResearchEnabled = researchState === 'open-enabled';
  const startExpanded = researchState !== 'closed';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Claude Lexical Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; }
      .composer { display: grid; gap: 12px; }
      .lexical-editor { border: 1px solid #bbb; min-height: 140px; padding: 10px; border-radius: 8px; }
      .send-control[aria-disabled="true"] { opacity: 0.4; }
      .send-control.is-enabled { opacity: 1; }
      .toolbar { display: flex; justify-content: flex-end; gap: 8px; }
      [data-radix-portal] { position: relative; z-index: 10; }
      .portal-menu { position: absolute; right: 0; top: 0; background: white; border: 1px solid #ccc; border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
      .portal-menu[hidden] { display: none; }
      .menu-item { display: flex; align-items: center; gap: 6px; cursor: pointer; }
      .menu-item svg { width: 16px; height: 16px; }
      .incognito-toggle { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border: 1px solid #999; border-radius: 16px; cursor: pointer; }
    </style>
  </head>
  <body data-variant="lexical">
    <div class="composer">
      <header class="toolbar">
        <button id="tools-trigger" type="button" aria-label="Open tools menu" aria-expanded="${startExpanded}">
          <span>Quick actions</span>
        </button>
        <div id="incognito-toggle" class="incognito-toggle" role="button" data-testid="incognito-mode-toggle" aria-pressed="false" data-state="inactive">
          <svg><title>ghost</title></svg>
          <span>Incognito</span>
        </div>
        <div id="send-control" class="send-control" role="button" data-testid="chat-composer__send-control" aria-disabled="true">
          <button id="send-button-inner" type="button" data-testid="chat-composer__send" aria-disabled="true" disabled hidden></button>
          <span>Send (⌘⏎)</span>
        </div>
      </header>
      <main>
        <div id="lexical-editor" class="lexical-editor" data-lexical-editor="true" data-editor-id="composer-lex-1" data-testid="chat-composer__editor" contenteditable="${editableMode}" role="textbox" aria-multiline="true" aria-label="Message Claude"><p><br /></p></div>
        <textarea id="fallback-textarea" name="message" data-testid="composer-textarea" aria-hidden="true" hidden></textarea>
      </main>
    </div>
    <div id="portal-root" data-radix-portal></div>
    <script type="module">
      const sendControl = document.getElementById('send-control');
      const sendButton = document.getElementById('send-button-inner');
      const incognitoToggle = document.getElementById('incognito-toggle');
      const toolsTrigger = document.getElementById('tools-trigger');
      const portalRoot = document.getElementById('portal-root');
      let activeEditor = document.getElementById('lexical-editor');
      const lexicalState = { payload: null };

      window.__sendClicks = 0;
      window.__researchEnabled = ${initialResearchEnabled};
      window.__incognitoActive = false;
      window.__incognitoClicks = 0;
      window.__lastComposerHtml = activeEditor ? activeEditor.innerHTML : '';
      window.__editorRemounted = false;
      window.__activeEditorId = activeEditor ? activeEditor.getAttribute('data-editor-id') || 'unknown' : 'unknown';

      const escapeHtml = (value) => {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      };

      const lexicalPayloadToHtml = (payload) => {
        if (!payload || !payload.root) return '<p><br /></p>';
        const children = Array.isArray(payload.root.children) ? payload.root.children : [];
        if (!children.length) return '<p><br /></p>';
        return children
          .map((paragraph) => {
            const texts = Array.isArray(paragraph?.children) ? paragraph.children : [];
            if (!texts.length) return '<p><br /></p>';
            const textContent = texts
              .map((node) => escapeHtml(node?.text || ''))
              .join('')
              .replace(/\\n/g, '<br />');
            return textContent ? \`<p>\${textContent}</p>\` : '<p><br /></p>';
          })
          .join('');
      };

      const updateSendEnabled = (enabled) => {
        const value = enabled ? 'false' : 'true';
        sendControl.setAttribute('aria-disabled', value);
        sendButton.setAttribute('aria-disabled', value);
        if (enabled) {
          sendControl.classList.add('is-enabled');
          sendButton.removeAttribute('disabled');
        } else {
          sendControl.classList.remove('is-enabled');
          sendButton.setAttribute('disabled', '');
        }
      };

      const attachEditor = (editor) => {
        if (!editor) return;
        const handleInput = () => {
          window.__activeEditorId = editor.getAttribute('data-editor-id') || 'unknown';
          window.__lastComposerHtml = editor.innerHTML;
          updateSendEnabled(true);
        };
        editor.addEventListener('beforeinput', handleInput);
        editor.addEventListener('input', handleInput);
        editor.addEventListener('paste', handleInput);
      };

      const attachLexicalStub = (editor) => {
        if (!editor) return;
        const stub = {
          parseEditorState(payload) {
            return JSON.parse(JSON.stringify(payload));
          },
          setEditorState(payload) {
            lexicalState.payload = JSON.parse(JSON.stringify(payload));
            editor.innerHTML = lexicalPayloadToHtml(payload);
            window.__lastComposerHtml = editor.innerHTML;
            updateSendEnabled(true);
            return Promise.resolve();
          },
          focus() {
            editor.focus();
          },
          getRootElement() {
            return editor;
          },
        };
        editor.__lexicalEditor = stub;
      };

      attachEditor(activeEditor);
      attachLexicalStub(activeEditor);

      const handleSend = () => {
        window.__sendClicks += 1;
        if (activeEditor) {
          window.__lastComposerHtml = activeEditor.innerHTML;
        }
        updateSendEnabled(false);
      };

      sendControl.addEventListener('click', handleSend);
      sendButton.addEventListener('click', handleSend);

      const closeMenu = () => {
        toolsTrigger.setAttribute('aria-expanded', 'false');
        portalRoot.innerHTML = '';
      };

      const ensureMenu = () => {
        let menu = portalRoot.querySelector('[role="menu"]');
        if (!menu) {
          menu = document.createElement('div');
          menu.setAttribute('role', 'menu');
          menu.classList.add('portal-menu');

          const researchItem = document.createElement('div');
          researchItem.className = 'menu-item';
          researchItem.setAttribute('role', 'menuitemcheckbox');
          researchItem.setAttribute('data-testid', 'research-mode-toggle');
          researchItem.setAttribute('aria-checked', String(window.__researchEnabled));
          researchItem.dataset.state = window.__researchEnabled ? 'on' : 'off';
          researchItem.innerHTML = '<svg><title>ghost</title></svg><span>Research</span>';
          researchItem.addEventListener('click', () => {
            window.__researchEnabled = !window.__researchEnabled;
            researchItem.dataset.state = window.__researchEnabled ? 'on' : 'off';
            researchItem.setAttribute('aria-checked', String(window.__researchEnabled));
          });

          menu.appendChild(researchItem);
          portalRoot.appendChild(menu);
        }
        return menu;
      };

      if (${startExpanded}) {
        ensureMenu();
        toolsTrigger.setAttribute('aria-expanded', 'true');
      }

      toolsTrigger.addEventListener('click', () => {
        const expanded = toolsTrigger.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          closeMenu();
        } else {
          toolsTrigger.setAttribute('aria-expanded', 'true');
          ensureMenu().removeAttribute('hidden');
        }
      });

      document.body.addEventListener('click', (event) => {
        if (event.target === toolsTrigger || portalRoot.contains(event.target)) {
          return;
        }
        closeMenu();
      });

      incognitoToggle.addEventListener('click', () => {
        window.__incognitoClicks += 1;
        incognitoToggle.setAttribute('aria-pressed', 'true');
        incognitoToggle.dataset.state = 'active';
        document.body.dataset.incognito = 'active';
        try {
          history.replaceState(null, '', '?incognito=1');
        } catch {
          // ignore history errors
        }
        window.__incognitoActive = true;

        if (${incognitoRemountsEditor}) {
          const replacement = activeEditor.cloneNode(false);
          const nextId = 'composer-lex-' + Math.floor(Math.random() * 1000);
          replacement.setAttribute('data-editor-id', nextId);
          replacement.innerHTML = '<p><br /></p>';
          activeEditor.replaceWith(replacement);
          activeEditor = replacement;
          window.__editorRemounted = true;
          attachEditor(activeEditor);
          attachLexicalStub(activeEditor);
        }
      });
    </script>
  </body>
</html>`;
}

function renderSonnet45Fixture(options: Required<ClaudeFixtureOptions>): string {
  const { researchState, incognitoRemountsEditor } = options;
  const researchEnabled = researchState === 'open-enabled';
  const editableMode = options.contentEditableMode === 'plaintext-only' ? 'plaintext-only' : 'true';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Claude Sonnet 4.5 Fixture</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body { font-family: sans-serif; margin: 0; padding: 16px; background: #f5f5f5; }
      .workspace { display: flex; flex-direction: column; gap: 16px; }
      .model-selector { display: flex; align-items: center; gap: 12px; }
      .model-pill { border-radius: 20px; padding: 6px 14px; border: 1px solid transparent; background: #fff; box-shadow: 0 0.25rem 1.25rem rgba(15,23,42,0.08); cursor: pointer; }
      .model-pill[data-state="on"] { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb inset; }
      .model-pill span { font-weight: 600; }
      .composer-frame { background: #fff; padding: 16px; border-radius: 16px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.1); display: flex; flex-direction: column; gap: 14px; }
      .toolbar { display: flex; align-items: center; gap: 10px; justify-content: space-between; }
      .toolbar-left { display: flex; align-items: center; gap: 10px; }
      .toolbar-right { display: flex; align-items: center; gap: 10px; }
      .toggle-pill { border-radius: 999px; padding: 6px 12px; border: 1px solid #cbd5f5; background: #fff; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
      .toggle-pill[data-state="active"] { border-color: #2563eb; background: rgba(37, 99, 235, 0.1); }
      .toggle-pill svg { width: 16px; height: 16px; }
      .editor-shell { border: 1px solid #d1d5db; border-radius: 12px; padding: 12px; min-height: 160px; background: #fff; }
      .editor-shell[data-empty="true"]::after { content: 'Ask Claude anything...'; color: #9ca3af; }
      .send-row { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
      .send-button { background: #2563eb; color: #fff; border-radius: 999px; padding: 10px 18px; border: none; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
      .send-button[aria-disabled="true"] { opacity: 0.45; cursor: not-allowed; }
      .send-control { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 10px 18px; border: 1px solid transparent; background: rgba(37, 99, 235, 0.1); color: #1f2937; cursor: pointer; }
      .send-control[aria-disabled="true"] { opacity: 0.5; cursor: not-allowed; }
      .send-control.is-enabled { background: #2563eb; color: #fff; }
    </style>
  </head>
  <body data-variant="sonnet45">
    <div class="workspace">
      <div class="model-selector" data-testid="model-selector">
        <div data-state="closed"></div>
        <button
          id="model-pill-sonnet"
          class="model-pill"
          type="button"
          data-testid="model-pill"
          data-model="sonnet-4-5"
          data-state="on"
        >
          <span class="!box-content flex flex-col bg-bg-000 mx-2 md:mx-0 items-stretch transition-all duration-200 relative cursor-text z-10 rounded-2xl border border-transparent shadow">Sonnet 4.5</span>
        </button>
        <button
          id="model-pill-research"
          class="model-pill"
          type="button"
          data-testid="model-pill-research"
          data-state="${researchEnabled ? 'on' : 'off'}"
          aria-pressed="${researchEnabled}"
        >
          <span>Research</span>
        </button>
      </div>
      <div class="composer-frame">
        <div class="toolbar">
          <div class="toolbar-left">
            <button
              id="quick-actions-trigger"
              type="button"
              aria-label="Open tools menu"
              data-testid="quick-actions-trigger"
              aria-expanded="false"
            >
              ⚙️ Quick actions
            </button>
          </div>
          <div class="toolbar-right">
            <button
              id="incognito-toggle"
              class="toggle-pill"
              type="button"
              data-testid="composer-mode-incognito"
              data-state="inactive"
              aria-pressed="false"
            >
              <svg><title>ghost</title><circle cx="8" cy="8" r="7" fill="#94a3b8" /></svg>
              <span>Incognito</span>
            </button>
          </div>
        </div>
        <div
          id="sonnet-editor"
          class="editor-shell"
          data-lexical-editor="true"
          data-testid="composer-rich-input"
          data-editor-id="composer-sonnet-1"
          contenteditable="${editableMode}"
          role="textbox"
          aria-multiline="true"
          aria-label="Message Claude"
          data-empty="true"
        ><p><br /></p></div>
        <textarea id="sonnet-textarea" name="message" data-testid="composer-textarea" hidden></textarea>
        <div class="send-row">
          <div
            id="send-control"
            class="send-control"
            role="button"
            data-testid="chat-composer__send-control"
            aria-disabled="true"
          >
            <span>Send (⌘⏎)</span>
          </div>
          <button
            id="send-button"
            class="send-button"
            type="button"
            data-testid="artifacts-send-button"
            aria-disabled="true"
            disabled
          >
            <span>Send</span>
            <span class="shortcut">⌘⏎</span>
          </button>
        </div>
      </div>
    </div>
    <script type="module">
      let editor = document.getElementById('sonnet-editor');
      const textarea = document.getElementById('sonnet-textarea');
      const sendButton = document.getElementById('send-button');
      const sendControl = document.getElementById('send-control');
      const incognitoToggle = document.getElementById('incognito-toggle');
      const researchPill = document.getElementById('model-pill-research');
      const quickActionsTrigger = document.getElementById('quick-actions-trigger');
      const portalRoot = document.createElement('div');
      portalRoot.dataset.radixPortal = '';
      document.body.appendChild(portalRoot);

      window.__sendClicks = 0;
      window.__researchEnabled = ${researchEnabled};
      window.__incognitoActive = false;
      window.__incognitoClicks = 0;
      window.__lastComposerHtml = editor ? editor.innerHTML : '';
      window.__editorRemounted = false;
      window.__activeEditorId = editor ? editor.getAttribute('data-editor-id') || 'unknown' : 'unknown';

      const updateSendState = (enabled) => {
        const disabledAttr = enabled ? 'false' : 'true';
        sendButton.setAttribute('aria-disabled', disabledAttr);
        sendControl.setAttribute('aria-disabled', disabledAttr);
        if (enabled) {
          sendButton.removeAttribute('disabled');
          sendControl.classList.add('is-enabled');
        } else {
          sendButton.setAttribute('disabled', '');
          sendControl.classList.remove('is-enabled');
        }
      };

      const recordEditorContent = () => {
        if (!editor) return;
        const trimmed = editor.innerHTML.trim();
        editor.dataset.empty = trimmed === '' || trimmed === '<p><br></p>';
        window.__lastComposerHtml = editor.innerHTML;
        window.__activeEditorId = editor.getAttribute('data-editor-id') || 'unknown';
        updateSendState(true);
      };

      if (editor) {
        editor.addEventListener('beforeinput', recordEditorContent);
        editor.addEventListener('input', recordEditorContent);
        editor.addEventListener('paste', recordEditorContent);
        editor.addEventListener('focus', () => {
          editor.dataset.focused = 'true';
        });
      }

      const handleSend = () => {
        window.__sendClicks += 1;
        const currentEditor = editor;
        if (currentEditor) {
          window.__lastComposerHtml = currentEditor.innerHTML;
          currentEditor.innerHTML = '<p><br /></p>';
          currentEditor.dataset.empty = 'true';
        }
        textarea.value = '';
        updateSendState(false);
      };

      sendButton.addEventListener('click', handleSend);
      sendControl.addEventListener('click', () => {
        if (sendControl.getAttribute('aria-disabled') === 'true') return;
        handleSend();
      });

      if (researchPill) {
        const setResearchState = (enabled) => {
          researchPill.dataset.state = enabled ? 'on' : 'off';
          researchPill.setAttribute('aria-pressed', String(enabled));
          window.__researchEnabled = enabled;
        };
        setResearchState(${researchEnabled});
        researchPill.addEventListener('click', () => {
          const next = !(researchPill.dataset.state === 'on');
          setResearchState(next);
        });
      }

      const ensureMenu = () => {
        let menu = portalRoot.querySelector('[role="menu"]');
        if (!menu) {
          menu = document.createElement('div');
          menu.className = 'portal-menu';
          menu.setAttribute('role', 'menu');
          const researchItem = document.createElement('div');
          researchItem.className = 'menu-item';
          researchItem.setAttribute('role', 'menuitemcheckbox');
          researchItem.setAttribute('data-testid', 'research-mode-toggle');
          researchItem.dataset.state = window.__researchEnabled ? 'on' : 'off';
          researchItem.setAttribute('aria-checked', String(window.__researchEnabled));
          researchItem.textContent = 'Activate research';
          researchItem.addEventListener('click', () => {
            const next = !window.__researchEnabled;
            window.__researchEnabled = next;
            researchItem.dataset.state = next ? 'on' : 'off';
            researchItem.setAttribute('aria-checked', String(next));
          });
          menu.appendChild(researchItem);
          portalRoot.appendChild(menu);
        }
        return menu;
      };

      quickActionsTrigger.addEventListener('click', () => {
        const expanded = quickActionsTrigger.getAttribute('aria-expanded') === 'true';
        if (expanded) {
          quickActionsTrigger.setAttribute('aria-expanded', 'false');
          portalRoot.innerHTML = '';
        } else {
          quickActionsTrigger.setAttribute('aria-expanded', 'true');
          ensureMenu();
        }
      });

      document.body.addEventListener('click', (event) => {
        if (event.target === quickActionsTrigger) return;
        if (portalRoot.contains(event.target)) return;
        quickActionsTrigger.setAttribute('aria-expanded', 'false');
        portalRoot.innerHTML = '';
      });

      if (incognitoToggle) {
        incognitoToggle.addEventListener('click', () => {
          window.__incognitoClicks += 1;
          const nextActive = incognitoToggle.dataset.state !== 'active';
          incognitoToggle.dataset.state = nextActive ? 'active' : 'inactive';
          incognitoToggle.setAttribute('aria-pressed', String(nextActive));
          window.__incognitoActive = nextActive;
          document.body.dataset.incognito = nextActive ? 'active' : 'inactive';
          if (nextActive) {
            try { history.replaceState(null, '', '?incognito=1'); } catch {}
          }
          if (${incognitoRemountsEditor}) {
            const currentEditor = editor;
            const replacement = currentEditor ? currentEditor.cloneNode(false) : null;
            if (!replacement) return;
            const nextId = 'composer-sonnet-' + Math.floor(Math.random() * 900 + 100);
            replacement.setAttribute('data-editor-id', nextId);
            replacement.innerHTML = '<p><br /></p>';
            replacement.dataset.empty = 'true';
            if (currentEditor && currentEditor.parentElement) {
              currentEditor.parentElement.replaceChild(replacement, currentEditor);
            }
            editor = /** @type {HTMLElement} */ (replacement);
            window.__editorRemounted = true;
            window.__activeEditorId = nextId;
            editor.addEventListener('beforeinput', recordEditorContent);
            editor.addEventListener('input', recordEditorContent);
            editor.addEventListener('paste', recordEditorContent);
          }
        });
      }

      window.__triggerKeyboardSendFallback = () => {
        handleSend();
        return true;
      };
    </script>
  </body>
</html>`;
}

export function createClaudeFixture(options: ClaudeFixtureOptions = {}): string {
  const merged: Required<ClaudeFixtureOptions> = {
    ...defaultOptions,
    ...options,
  } as Required<ClaudeFixtureOptions>;

  return merged.variant === 'lexical'
    ? renderLexicalFixture(merged)
    : merged.variant === 'sonnet45'
    ? renderSonnet45Fixture(merged)
    : renderLegacyFixture(merged);
}
