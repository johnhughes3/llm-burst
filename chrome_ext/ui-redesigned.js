// UI rendering module with single-line providers and advanced dropdown
export function detectMode() {
  const url = window.location.href;
  return url.includes('launcher.html') ? 'launcher' : 'popup';
}

// Safe DOM construction helper
const ALLOWED_EVENTS = ['click', 'change', 'input', 'focus', 'blur', 'keydown', 'compositionstart', 'compositionend'];
const BOOLEAN_ATTRS = ['checked', 'disabled', 'hidden', 'selected', 'readonly', 'open'];

function createElement(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  
  // Set attributes safely
  Object.entries(attrs).forEach(([key, val]) => {
    if (key === 'className') {
      el.className = val;
    } else if (key === 'innerHTML') {
      // Skip innerHTML for safety
      console.warn('innerHTML not allowed, use text or child elements');
    } else if (key === 'style' && typeof val === 'string') {
      // Allow style string for specific cases
      el.style.cssText = val;
    } else if (key.startsWith('data-')) {
      el.dataset[key.slice(5)] = val;
    } else if (key.startsWith('on') && typeof val === 'function') {
      // Validate event handlers
      const eventName = key.slice(2).toLowerCase();
      if (ALLOWED_EVENTS.includes(eventName)) {
        el.addEventListener(eventName, val);
      } else {
        console.warn(`Event handler ${key} not allowed`);
      }
    } else if (BOOLEAN_ATTRS.includes(key)) {
      el[key] = val;
    } else if (key === 'for') {
      el.setAttribute('for', val);
    } else {
      // Sanitize attribute value
      el.setAttribute(key, String(val).replace(/[<>\"']/g, ''));
    }
  });
  
  // Add children
  children.forEach(child => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Element) {
      el.appendChild(child);
    } else if (child) {
      console.warn('Invalid child type:', child);
    }
  });
  
  return el;
}

// Create header component
function createHeader() {
  const header = createElement('header', { className: 'header' }, [
    createElement('div', { className: 'header__logo' }, [
      createElement('div', { className: 'header__logo-icon' }, ['⚡']),
      createElement('span', { className: 'header__brand' }, ['LLM Burst'])
    ]),
    createElement('button', { 
      className: 'header__settings-btn',
      id: 'settingsBtn',
      'aria-label': 'Settings'
    }, ['⚙'])
  ]);
  
  return header;
}

// Create session selector
function createSessionSection() {
  const section = createElement('div', { className: 'section', id: 'sessionSection' }, [
    createElement('label', { 
      className: 'section__label',
      for: 'sessionSelect'
    }, ['Session']),
    createElement('select', {
      className: 'session-select',
      id: 'sessionSelect',
      'aria-label': 'Select conversation session'
    }, [
      createElement('option', { value: '__new__', selected: true }, ['New conversation'])
    ])
  ]);
  
  return section;
}

// Create prompt section
function createPromptSection() {
  const section = createElement('div', { className: 'section prompt', id: 'promptSection' }, [
    createElement('div', { className: 'prompt__header' }, [
      createElement('label', { 
        className: 'section__label',
        for: 'prompt'
      }, [
        'Prompt',
        createElement('span', { className: 'section__hint', id: 'promptHint' }, ['⌘+Enter to send'])
      ]),
      createElement('div', { className: 'prompt__actions' }, [
        createElement('button', {
          className: 'btn btn--danger',
          id: 'clearBtn',
          style: 'display: none;',
          'aria-label': 'Clear prompt'
        }, ['Clear']),
        createElement('button', {
          className: 'btn',
          id: 'pasteBtn',
          'aria-label': 'Paste from clipboard'
        }, ['📋 Paste'])
      ])
    ]),
    createElement('textarea', {
      className: 'prompt__textarea',
      id: 'prompt',
      placeholder: 'Paste or type your prompt...',
      rows: '8',
      'aria-label': 'Enter your prompt',
      'aria-describedby': 'promptHint'
    }),
    createElement('div', { className: 'prompt__footer' }, [
      createElement('span', { 
        className: 'prompt__char-count',
        id: 'charCount',
        style: 'display: none;'
      }),
      createElement('span', {
        className: 'prompt__draft-status',
        id: 'draftStatus',
        style: 'display: none;'
      }, ['Draft saved'])
    ])
  ]);
  
  return section;
}

// Create single-line provider selection
function createProvidersInline() {
  const providers = [
    { id: 'CHATGPT', name: 'ChatGPT' },
    { id: 'CLAUDE', name: 'Claude' },
    { id: 'GEMINI', name: 'Gemini' },
    { id: 'GROK', name: 'Grok' }
  ];
  
  const section = createElement('div', {
    className: 'section providers-inline-section',
    id: 'providerSection'
  }, [
    createElement('div', { className: 'providers-inline' }, [
      createElement('span', { className: 'providers-inline__label' }, ['AI:']),
      ...providers.map(provider => 
        createElement('label', {
          className: 'provider-pill',
          'data-provider': provider.id
        }, [
          createElement('input', {
            type: 'checkbox',
            className: 'provider-pill__checkbox',
            id: `prov-${provider.id.toLowerCase()}`,
            'data-provider': provider.id
          }),
          createElement('span', {}, [provider.name])
        ])
      )
    ])
  ]);
  
  return section;
}

// Create advanced options section (collapsible)
function createAdvancedSection() {
  const section = createElement('div', {
    className: 'section',
    id: 'advancedSection'
  }, [
    createElement('details', { className: 'advanced-options', id: 'advancedOptions' }, [
      createElement('summary', { className: 'advanced-options__toggle' }, [
        'Advanced Options'
      ]),
      createElement('div', { className: 'advanced-options__content' }, [
        // Options section (Research & Incognito)
        createElement('div', { className: 'options-row', id: 'optionsSection' }, [
          createElement('label', { className: 'option-inline' }, [
            createElement('input', {
              type: 'checkbox',
              className: 'option-inline__checkbox',
              id: 'research',
              'data-option': 'research'
            }),
            createElement('span', {}, ['🔍 Research'])
          ]),
          createElement('label', { className: 'option-inline' }, [
            createElement('input', {
              type: 'checkbox',
              className: 'option-inline__checkbox',
              id: 'incognito',
              'data-option': 'incognito'
            }),
            createElement('span', {}, ['🕵️ Incognito'])
          ]),
          createElement('span', { className: 'keyboard-hints' }, [
            'Alt+R / Alt+I'
          ])
        ]),
        // Title section
        createElement('div', { className: 'title-row', id: 'titleSection' }, [
          createElement('label', {
            className: 'section__label',
            for: 'groupTitle'
          }, ['Session Title']),
          createElement('div', { className: 'title-input-group' }, [
            createElement('input', {
              type: 'text',
              className: 'title-input',
              id: 'groupTitle',
              placeholder: 'Auto-generated from prompt...',
              maxlength: '80',
              'aria-label': 'Session title',
              'aria-describedby': 'titleHint'
            }),
            createElement('button', {
              className: 'btn btn--icon',
              id: 'autonameBtn',
              'aria-label': 'Auto-generate title'
            }, [
              createElement('span', { 
                className: 'spinner',
                id: 'autonameSpinner',
                hidden: true
              }),
              createElement('span', { id: 'autonameIcon' }, ['↻'])
            ])
          ])
        ])
      ])
    ])
  ]);
  
  return section;
}

// Create status section
function createStatusSection() {
  return createElement('div', {
    className: 'section',
    id: 'statusSection'
  }, [
    createElement('div', {
      className: 'status-message',
      id: 'status',
      role: 'status',
      'aria-live': 'polite',
      style: 'display: none;'
    })
  ]);
}

// Create send button
function createSendButton(mode) {
  const showShortcut = mode === 'launcher';
  
  return createElement('button', {
    className: 'send-button',
    id: 'sendButton'
  }, [
    '➤ ',
    createElement('span', { id: 'sendButtonText' }, ['Send']),
    showShortcut ? createElement('span', { 
      className: 'send-button__shortcut' 
    }, ['⌘+Enter']) : null
  ].filter(Boolean));
}

// Main render function
export function renderApp({ mode = 'popup' } = {}) {
  const isLauncher = mode === 'launcher';
  
  // Create app container
  const app = createElement('div', { className: 'app' }, [
    createHeader(),
    createElement('main', { className: 'main' }, [
      createSessionSection(),
      createPromptSection(),
      createProvidersInline(),
      createAdvancedSection(),
      createStatusSection(),
      createSendButton(mode)
    ])
  ]);
  
  // Clear body and append new content
  document.body.innerHTML = '';
  document.body.appendChild(app);
  
  // Add event listeners for provider pills
  document.querySelectorAll('.provider-pill').forEach(pill => {
    const checkbox = pill.querySelector('.provider-pill__checkbox');
    
    pill.addEventListener('click', (e) => {
      if (e.target === checkbox) return; // Let checkbox handle its own click
      e.preventDefault(); // Prevent label's default behavior
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    checkbox.addEventListener('change', () => {
      pill.classList.toggle('provider-pill--selected', checkbox.checked);
    });
  });
  
  // Initialize UI state based on session
  setTimeout(() => {
    const sessionSelect = document.getElementById('sessionSelect');
    if (sessionSelect) {
      sessionSelect.addEventListener('change', updateUIState);
      updateUIState();
    }
  }, 100);
}

// Update UI based on session state
function updateUIState() {
  const sessionSelect = document.getElementById('sessionSelect');
  const isNewSession = !sessionSelect || sessionSelect.value === '__new__';
  
  // Elements to hide/show based on state
  const advancedSection = document.getElementById('advancedSection');
  if (advancedSection) {
    if (isNewSession) {
      advancedSection.classList.remove('section--hidden');
      advancedSection.setAttribute('aria-hidden', 'false');
    } else {
      advancedSection.classList.add('section--hidden');
      advancedSection.setAttribute('aria-hidden', 'true');
    }
  }
  
  // Update send button text
  const sendButtonText = document.getElementById('sendButtonText');
  if (sendButtonText) {
    sendButtonText.textContent = isNewSession ? 'Send' : 'Continue Thread';
  }
  
  // Adjust textarea rows
  const promptTextarea = document.getElementById('prompt');
  if (promptTextarea) {
    promptTextarea.rows = isNewSession ? 8 : 12;
  }
}