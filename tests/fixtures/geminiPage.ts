type GeminiFixtureVariant = 'legacy' | 'modern' | 'textarea';

export interface GeminiFixtureOptions {
  variant?: GeminiFixtureVariant;
  includeHiddenLegacyEditor?: boolean;
}

const defaultOptions: Required<GeminiFixtureOptions> = {
  variant: 'legacy',
  includeHiddenLegacyEditor: false,
};

function renderLegacyFixture(): string {
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
    <div class="toolbar">
      <button class="toolbox-drawer-button" aria-label="Tools">Tools</button>
      <button aria-label="Canvas">Canvas</button>
    </div>
    <div id="gemini-editor" class="ql-editor" contenteditable="true" role="textbox" aria-label="Ask Gemini"><p><br /></p></div>
    <button id="send-button" class="send-button" type="button" aria-label="Send message" aria-disabled="true" disabled>Send</button>
    <script type="module">
      const editor = document.getElementById('gemini-editor');
      const sendButton = document.getElementById('send-button');

      window.__sendClicks = 0;
      window.__lastComposerText = '';

      const enableSend = () => {
        sendButton.removeAttribute('disabled');
        sendButton.setAttribute('aria-disabled', 'false');
        sendButton.classList.remove('disabled');
      };

      editor.addEventListener('input', () => {
        window.__lastComposerText = editor.innerText || editor.textContent || '';
        setTimeout(enableSend, 20);
      });

      sendButton.addEventListener('click', () => {
        window.__sendClicks += 1;
      });
    </script>
  </body>
</html>`;
}

function renderModernFixture(includeHiddenLegacyEditor: boolean): string {
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
    <div class="toolbar">
      <button class="toolbox-drawer-button" aria-label="Tools">Tools</button>
      <button aria-label="Canvas">Canvas</button>
    </div>
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
      const editor = document.getElementById('gemini-modern-editor');
      const sendButton = document.getElementById('send-button');

      window.__sendClicks = 0;
      window.__lastComposerText = '';

      const enableSend = () => {
        sendButton.removeAttribute('disabled');
        sendButton.setAttribute('aria-disabled', 'false');
        sendButton.classList.remove('disabled');
      };

      editor.addEventListener('input', () => {
        window.__lastComposerText = editor.innerText || editor.textContent || '';
        setTimeout(enableSend, 20);
      });

      sendButton.addEventListener('click', () => {
        window.__sendClicks += 1;
      });
    </script>
  </body>
</html>`;
}

function renderTextareaFixture(): string {
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
    <div class="toolbar">
      <button class="toolbox-drawer-button" aria-label="Tools">Tools</button>
      <button aria-label="Canvas">Canvas</button>
    </div>
    <textarea id="gemini-textarea" aria-label="Ask Gemini"></textarea>
    <button id="send-button" type="submit" aria-label="Send message" aria-disabled="true" disabled>Send</button>
    <script type="module">
      const editor = document.getElementById('gemini-textarea');
      const sendButton = document.getElementById('send-button');

      window.__sendClicks = 0;
      window.__lastComposerText = '';

      const enableSend = () => {
        sendButton.removeAttribute('disabled');
        sendButton.setAttribute('aria-disabled', 'false');
        sendButton.classList.remove('disabled');
      };

      editor.addEventListener('input', () => {
        window.__lastComposerText = editor.value || '';
        setTimeout(enableSend, 20);
      });

      sendButton.addEventListener('click', () => {
        window.__sendClicks += 1;
      });
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
    return renderModernFixture(merged.includeHiddenLegacyEditor);
  }

  if (merged.variant === 'textarea') {
    return renderTextareaFixture();
  }

  return renderLegacyFixture();
}
