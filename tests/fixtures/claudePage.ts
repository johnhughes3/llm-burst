type ResearchState = 'closed' | 'open-disabled' | 'open-enabled';

export interface ClaudeFixtureOptions {
  includeHiddenEditor?: boolean;
  researchState?: ResearchState;
  incognitoButton?: boolean;
  incognitoRemountsEditor?: boolean;
}

const defaultOptions: Required<ClaudeFixtureOptions> = {
  includeHiddenEditor: false,
  researchState: 'closed',
  incognitoButton: false,
  incognitoRemountsEditor: false,
};

function renderResearchMenu(state: ResearchState): string {
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

function renderIncognitoButton(includeButton: boolean): string {
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

export function createClaudeFixture(options: ClaudeFixtureOptions = {}): string {
  const { includeHiddenEditor, researchState, incognitoButton, incognitoRemountsEditor } = {
    ...defaultOptions,
    ...options,
  };

  const hiddenEditor = includeHiddenEditor
    ? '<div class="ProseMirror" style="display:none" contenteditable="true"></div>'
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
  <body>
    ${hiddenEditor}
    <header>
      ${renderResearchMenu(researchState)}
      ${renderIncognitoButton(incognitoButton)}
      <button id="send-button" type="button" data-testid="send-button" aria-label="Send message" aria-disabled="true" disabled>
        <span>Send</span>
      </button>
    </header>
    <main>
      <div class="ProseMirror" data-editor-id="composer-1" contenteditable="true"><p><br /></p></div>
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
        const activeEditor = document.querySelector('.ProseMirror[contenteditable="true"]:not([style*="display:none"])');
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
