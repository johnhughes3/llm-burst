export interface ChatGPTFixtureOptions {
  mockResearchActivation?: boolean;
}

export function createChatGPTFixture(options: ChatGPTFixtureOptions = {}): string {
  const mockResearchActivation = options.mockResearchActivation ? 'true' : 'false';

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; }
    .composer { display: flex; align-items: center; gap: 8px; width: 760px; border: 1px solid #ddd; border-radius: 24px; padding: 8px 10px; }
    #prompt-textarea { flex: 1; min-height: 28px; outline: none; }
    #send-button { border: 0; border-radius: 999px; width: 34px; height: 34px; background: #111; color: white; cursor: pointer; }
    #send-button[disabled] { background: #bbb; cursor: default; }
  </style>
</head>
<body>
  <main>
    <button id="model-selector" type="button" aria-haspopup="menu" aria-label="Model selector, current model is Extended Pro">Extended Pro</button>
    <form class="composer" id="composer-form">
      <button type="button" aria-label="Add files and more">+</button>
      <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox" aria-label="Chat with ChatGPT"><p><br></p></div>
      <button id="send-button" type="submit" aria-label="Send message" aria-disabled="true" disabled>↑</button>
    </form>
  </main>
  <script>
    window.__sendClicks = 0;
    window.__submittedText = '';
    window.__researchActivationRequests = 0;

    const editor = document.getElementById('prompt-textarea');
    const sendButton = document.getElementById('send-button');
    const form = document.getElementById('composer-form');

    function normalize(value) {
      return String(value || '').replace(/\\s+/g, ' ').trim();
    }

    function editorText() {
      return normalize(editor.innerText || editor.textContent || '');
    }

    function updateSendState() {
      const hasText = editorText().length > 0;
      sendButton.disabled = !hasText;
      sendButton.setAttribute('aria-disabled', hasText ? 'false' : 'true');
    }

    editor.addEventListener('beforeinput', () => setTimeout(updateSendState, 0));
    editor.addEventListener('input', () => setTimeout(updateSendState, 0));
    editor.addEventListener('keyup', updateSendState);
    new MutationObserver(updateSendState).observe(editor, { childList: true, subtree: true, characterData: true });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      updateSendState();
      if (sendButton.disabled) return;
      window.__sendClicks += 1;
      window.__submittedText = editorText();
      editor.innerHTML = '<p><br></p>';
      updateSendState();
    });

    if (${mockResearchActivation}) {
      window.chrome = {
        runtime: {
          sendMessage(message, callback) {
            if (message && message.type === 'llmburst-chatgpt-enable-research') {
              window.__researchActivationRequests += 1;
              setTimeout(() => callback({ ok: true, activated: true }), 0);
              return;
            }
            setTimeout(() => callback({ ok: false, error: 'unexpected message' }), 0);
          }
        }
      };
    }

    updateSendState();
  </script>
</body>
</html>`;
}
