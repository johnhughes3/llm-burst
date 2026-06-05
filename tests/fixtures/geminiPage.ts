type GeminiFixtureVariant = 'legacy' | 'modern' | 'textarea';

export interface GeminiFixtureOptions {
  variant?: GeminiFixtureVariant;
  includeHiddenLegacyEditor?: boolean;
  includeDeepResearchTool?: boolean;
}

const defaultOptions: Required<GeminiFixtureOptions> = {
  variant: 'legacy',
  includeHiddenLegacyEditor: false,
  includeDeepResearchTool: false,
};

function renderToolbar(includeDeepResearchTool: boolean): string {
  const deepResearchButton = includeDeepResearchTool
    ? '<button type="button" id="deep-research-button" class="toolbox-drawer-item-list-button" aria-label="Deep Research">Deep Research</button>'
    : '';

  return `
    <div class="toolbar">
      <button id="tools-button" class="toolbox-drawer-button" aria-label="Tools">Tools</button>
      <div id="tool-drawer" hidden>
        <button type="button" id="canvas-button" aria-label="Canvas">Canvas</button>
        ${deepResearchButton}
      </div>
    </div>
    <div class="model-selector">
      <button id="model-button" type="button" aria-label="Open mode picker, currently Flash">Flash</button>
      <div id="model-menu" role="menu" hidden>
        <button type="button" class="model-option" data-model="3.1 Flash-Lite">3.1 Flash-Lite Fastest answers</button>
        <button type="button" class="model-option" data-model="3.5 Flash">3.5 Flash All-around help</button>
        <button type="button" class="model-option" data-model="3.1 Pro">3.1 Pro Advanced math and code</button>
        <button type="button" id="thinking-level-button" aria-label="Thinking level Standard">Thinking level Standard</button>
        <div id="thinking-menu" role="menu" hidden>
          <button type="button" class="thinking-option" data-thinking="Standard">Standard Best for most questions</button>
          <button type="button" class="thinking-option" data-thinking="Extended">Extended Complex problem solving</button>
          <button type="button" class="thinking-option" data-thinking="Deep Think">Deep Think Max parallel reasoning</button>
        </div>
      </div>
    </div>`;
}

function renderFixtureScript(editorExpression: string): string {
  return `
      const editor = ${editorExpression};
      const sendButton = document.getElementById('send-button');
      const toolsButton = document.getElementById('tools-button');
      const toolDrawer = document.getElementById('tool-drawer');
      const canvasButton = document.getElementById('canvas-button');
      const deepResearchButton = document.getElementById('deep-research-button');
      const modelButton = document.getElementById('model-button');
      const modelMenu = document.getElementById('model-menu');
      const thinkingLevelButton = document.getElementById('thinking-level-button');
      const thinkingMenu = document.getElementById('thinking-menu');

      window.__sendClicks = 0;
      window.__lastComposerText = '';
      window.__canvasEnabled = false;
      window.__deepResearchEnabled = false;
      window.__selectedModel = '3.5 Flash';
      window.__thinkingLevel = 'Standard';
      window.__modelClicks = [];
      window.__thinkingClicks = [];
      window.__researchStarted = 0;

      const updateModelButtonLabel = () => {
        const modelLabel = window.__selectedModel.includes('Pro') ? 'Pro' : window.__selectedModel;
        const thinkingSuffix = window.__thinkingLevel === 'Standard' ? '' : ' ' + window.__thinkingLevel;
        const label = (modelLabel + thinkingSuffix).trim();
        modelButton.textContent = label;
        modelButton.setAttribute('aria-label', 'Open mode picker, currently ' + label);
        thinkingLevelButton.textContent = 'Thinking level ' + window.__thinkingLevel;
        thinkingLevelButton.setAttribute('aria-label', 'Thinking level ' + window.__thinkingLevel);
      };

      const enableSend = () => {
        sendButton.removeAttribute('disabled');
        sendButton.setAttribute('aria-disabled', 'false');
        sendButton.classList.remove('disabled');
      };

      toolsButton.addEventListener('click', () => {
        toolDrawer.hidden = false;
      });

      canvasButton.addEventListener('click', () => {
        window.__canvasEnabled = true;
        canvasButton.setAttribute('aria-label', 'Deselect Canvas');
        canvasButton.classList.add('selected');
      });

      if (deepResearchButton) {
        deepResearchButton.addEventListener('click', () => {
          window.__deepResearchEnabled = true;
          deepResearchButton.setAttribute('aria-label', 'Deselect Deep Research');
          deepResearchButton.classList.add('selected');
        });
      }

      modelButton.addEventListener('click', () => {
        modelMenu.hidden = false;
      });

      modelMenu.querySelectorAll('.model-option').forEach((button) => {
        button.addEventListener('click', () => {
          const model = button.getAttribute('data-model') || button.textContent.trim();
          window.__selectedModel = model;
          window.__modelClicks.push(model);
          updateModelButtonLabel();
          modelMenu.hidden = true;
        });
      });

      thinkingLevelButton.addEventListener('click', () => {
        thinkingMenu.hidden = false;
      });

      thinkingMenu.querySelectorAll('.thinking-option').forEach((button) => {
        button.addEventListener('click', () => {
          const thinking = button.getAttribute('data-thinking') || button.textContent.trim();
          window.__thinkingLevel = thinking;
          window.__thinkingClicks.push(thinking);
          updateModelButtonLabel();
          thinkingMenu.hidden = true;
          modelMenu.hidden = true;
        });
      });

      editor.addEventListener('input', () => {
        window.__lastComposerText = editor.value || editor.innerText || editor.textContent || '';
        setTimeout(enableSend, 20);
      });

      sendButton.addEventListener('click', () => {
        const text = editor.value || editor.innerText || editor.textContent || '';
        if (!text.trim()) return;
        window.__sendClicks += 1;
        window.__lastComposerText = text;
        if ('value' in editor) {
          editor.value = '';
        } else {
          editor.innerHTML = '<p><br></p>';
        }
        sendButton.setAttribute('aria-disabled', 'true');
        sendButton.setAttribute('disabled', '');
        sendButton.classList.add('disabled');
        if (window.__deepResearchEnabled) {
          const existing = document.getElementById('start-research-button');
          if (!existing) {
            setTimeout(() => {
              const button = document.createElement('button');
              button.type = 'button';
              button.id = 'start-research-button';
              button.textContent = 'Start research';
              button.addEventListener('click', () => {
                window.__researchStarted += 1;
              });
              document.body.appendChild(button);
            }, 250);
          }
        }
      });`;
}

function renderLegacyFixture(includeDeepResearchTool: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Gemini Legacy Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; }
      .ql-editor { border: 1px solid #ccc; min-height: 120px; padding: 8px; }
      .send-button[aria-disabled="true"] { opacity: 0.4; }
    </style>
  </head>
  <body data-variant="legacy">
    ${renderToolbar(includeDeepResearchTool)}
    <div id="gemini-editor" class="ql-editor" contenteditable="true" role="textbox" aria-label="Ask Gemini"><p><br /></p></div>
    <button id="send-button" class="send-button" type="button" aria-label="Send message" aria-disabled="true" disabled>Send</button>
    <script type="module">
${renderFixtureScript("document.getElementById('gemini-editor')")}
    </script>
  </body>
</html>`;
}

function renderModernFixture(includeHiddenLegacyEditor: boolean, includeDeepResearchTool: boolean): string {
  const hiddenLegacyEditor = includeHiddenLegacyEditor
    ? '<div class="ql-editor" style="display:none" contenteditable="true"></div>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Gemini Modern Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; }
      .modern-editor { border: 1px solid #999; min-height: 140px; padding: 10px; border-radius: 10px; }
      .send-button[aria-disabled="true"] { opacity: 0.4; }
    </style>
  </head>
  <body data-variant="modern">
    ${renderToolbar(includeDeepResearchTool)}
    ${hiddenLegacyEditor}
    <div
      id="gemini-modern-editor"
      class="modern-editor"
      role="textbox"
      aria-label="Ask Gemini"
      data-testid="chat-input-editor"
      contenteditable="plaintext-only"
    ><p><br /></p></div>
    <button id="send-button" type="button" data-testid="send-button" aria-label="Send message" aria-disabled="true" disabled>Send</button>
    <script type="module">
${renderFixtureScript("document.getElementById('gemini-modern-editor')")}
    </script>
  </body>
</html>`;
}

function renderTextareaFixture(includeDeepResearchTool: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Gemini Textarea Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 16px; }
      textarea { width: 100%; min-height: 120px; padding: 8px; }
      button[aria-disabled="true"] { opacity: 0.4; }
    </style>
  </head>
  <body data-variant="textarea">
    ${renderToolbar(includeDeepResearchTool)}
    <textarea id="gemini-textarea" aria-label="Ask Gemini"></textarea>
    <button id="send-button" type="submit" aria-label="Send message" aria-disabled="true" disabled>Send</button>
    <script type="module">
${renderFixtureScript("document.getElementById('gemini-textarea')")}
    </script>
  </body>
</html>`;
}

export function createGeminiFixture(options: GeminiFixtureOptions = {}): string {
  const merged: Required<GeminiFixtureOptions> = {
    ...defaultOptions,
    ...options,
  };

  if (merged.variant === 'modern') {
    return renderModernFixture(merged.includeHiddenLegacyEditor, merged.includeDeepResearchTool);
  }

  if (merged.variant === 'textarea') {
    return renderTextareaFixture(merged.includeDeepResearchTool);
  }

  return renderLegacyFixture(merged.includeDeepResearchTool);
}
