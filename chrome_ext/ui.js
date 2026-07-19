// UI rendering module with providers in advanced options
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

// Inline SVG icons (stroke-based, inherit currentColor)
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', 'M21 21l-4.35-4.35'],
  ghost: [
    'M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z',
    'M9 10h.01',
    'M15 10h.01'
  ],
  chevron: ['M6 9l6 6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M18 6 6 18', 'M6 6l12 12']
};

function createIcon(name, size = 15) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  (ICON_PATHS[name] || []).forEach(d => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

// Create header component
function createHeader() {
  const header = createElement('header', { className: 'header' }, [
    createElement('div', { className: 'header__logo' }, [
      createElement('img', { className: 'header__logo-icon', src: 'icon.svg', alt: '' }),
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

// Create session selector (custom combobox rendered/managed by popup.js)
function createSessionSection() {
  const section = createElement('div', { className: 'section', id: 'sessionSection' }, [
    createElement('span', {
      className: 'section__label',
      id: 'sessionLabel'
    }, ['Chat']),
    createElement('div', { className: 'session-picker', id: 'sessionPicker' }, [
      createElement('button', {
        type: 'button',
        className: 'session-picker__trigger',
        id: 'sessionTrigger',
        'aria-haspopup': 'listbox',
        'aria-expanded': 'false',
        'aria-controls': 'sessionMenu',
        'aria-labelledby': 'sessionLabel sessionTriggerText'
      }, [
        createElement('span', {
          className: 'session-picker__value',
          id: 'sessionTriggerText'
        }, ['New conversation']),
        createIcon('chevron', 14)
      ]),
      createElement('div', {
        className: 'session-picker__menu',
        id: 'sessionMenu',
        role: 'listbox',
        'aria-labelledby': 'sessionLabel',
        hidden: true
      }),
      createElement('div', {
        className: 'sr-only',
        id: 'pickerStatus',
        role: 'status',
        'aria-live': 'polite'
      })
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
      rows: '6',
      'aria-label': 'Enter your prompt',
      'aria-describedby': 'promptHint'
    })
  ]);
  
  return section;
}

// Create options section (Research & Incognito) - Back in main view
function createOptionsSection() {
  const section = createElement('div', { 
    className: 'section',
    id: 'optionsSection'
  }, [
    createElement('div', { className: 'options' }, [
      // Research toggle
      createElement('label', { className: 'toggle' }, [
        createElement('input', {
          type: 'checkbox',
          className: 'toggle__input',
          id: 'research',
          'data-option': 'research'
        }),
        createElement('div', { className: 'toggle__switch' }, [
          createElement('div', { className: 'toggle__slider' })
        ]),
        createElement('div', { className: 'toggle__content' }, [
          createIcon('search'),
          createElement('span', {}, ['Research'])
        ])
      ]),
      // Incognito toggle
      createElement('label', { className: 'toggle' }, [
        createElement('input', {
          type: 'checkbox',
          className: 'toggle__input',
          id: 'incognito',
          'data-option': 'incognito'
        }),
        createElement('div', { className: 'toggle__switch' }, [
          createElement('div', { className: 'toggle__slider' })
        ]),
        createElement('div', { className: 'toggle__content' }, [
          createIcon('ghost'),
          createElement('span', {}, ['Incognito'])
        ])
      ])
    ])
  ]);
  
  return section;
}

// Create advanced options section with providers and title
function createAdvancedSection() {
  const providers = [
    { id: 'CHATGPT', name: 'ChatGPT', icon: 'C' },
    { id: 'CLAUDE', name: 'Claude', icon: 'Cl' },
    { id: 'GEMINI', name: 'Gemini', icon: 'G' },
    { id: 'GROK', name: 'Grok', icon: 'Gr' }
  ];
  
  const section = createElement('div', {
    className: 'section',
    id: 'advancedSection'
  }, [
    createElement('details', { className: 'advanced-options', id: 'advancedOptions' }, [
      createElement('summary', { className: 'advanced-options__toggle' }, [
        'Advanced Options'
      ]),
      createElement('div', { className: 'advanced-options__content' }, [
        // Provider selection on one line (no explicit label)
        createElement('div', { id: 'providerSection' }, [
          createElement('div', { className: 'providers providers--inline providers--nowrap' }, 
            providers.map(provider => 
              createElement('label', {
                className: 'provider-card provider-card--compact',
                'data-provider': provider.id
              }, [
                createElement('input', {
                  type: 'checkbox',
                  className: 'provider-card__checkbox',
                  id: `prov-${provider.id.toLowerCase()}`,
                  'data-provider': provider.id
                  // Don't hardcode checked state - let defaults load from storage
                }),
                createElement('div', { className: 'provider-card__icon' }, [provider.icon]),
                createElement('span', { className: 'provider-card__name' }, [provider.name]),
                createElement('div', { className: 'provider-card__check' })
              ])
            )
          )
        ]),
        // Title section (inline: label, input, refresh at right)
        createElement('div', { className: 'title-row', id: 'titleSection' }, [
          createElement('div', { className: 'title-inline' }, [
            createElement('label', {
              className: 'section__label section__label--inline',
              for: 'groupTitle'
            }, ['Title']),
            createElement('input', {
              type: 'text',
              className: 'title-input title-input--inline',
              id: 'groupTitle',
              placeholder: 'Auto-generated from prompt...',
              maxlength: '80',
              'aria-label': 'Chat title',
              'aria-describedby': 'titleHint'
            }),
            createElement('button', {
              className: 'btn btn--icon title-inline__refresh',
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
    createElement('span', { className: 'send-button__arrow', 'aria-hidden': 'true' }, ['➤']),
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
      createOptionsSection(),  // Research & Incognito
      createAdvancedSection(), // Advanced directly after toggles
      // Notices go beneath Advanced Options to free vertical space above
      createElement('div', { className: 'prompt__footer', id: 'inlinePromptFooter' }, [
        createElement('span', { 
          className: 'prompt__char-count',
          id: 'charCount',
          style: 'display: none;'
        }),
        createElement('span', {
          className: 'prompt__draft-status',
          id: 'draftStatus',
          style: 'display: none;',
          'aria-live': 'polite'
        }, ['Draft saved'])
      ]),
      createStatusSection()
    ]),
    // Keep the send button outside the scroll area so content never
    // flows under it when Advanced Options is opened.
    createElement('footer', { className: 'send-bar' }, [
      createSendButton(mode)
    ])
  ]);
  
  // Clear body and append new content
  document.body.innerHTML = '';
  document.body.appendChild(app);
  
  // Add event listener for provider card selection
  document.querySelectorAll('.provider-card').forEach(card => {
    const checkbox = card.querySelector('.provider-card__checkbox');
    
    card.addEventListener('click', (e) => {
      if (e.target === checkbox) return; // Let checkbox handle its own click
      e.preventDefault(); // Prevent label's default behavior
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    
    checkbox.addEventListener('change', () => {
      card.classList.toggle('provider-card--selected', checkbox.checked);
    });
    
    // Set initial state - don't set checked, let defaults load
    // Just update visual state based on current checked status
    if (checkbox.checked) {
      card.classList.add('provider-card--selected');
    }
  });
  
}

// Shared with popup.js (a classic script) for rendering session menu items
if (typeof window !== 'undefined') {
  window.llmBurstIcons = { createIcon };
}
