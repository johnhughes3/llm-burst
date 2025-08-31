import React, { useState, useEffect, useRef } from 'react';
import { Settings, Zap, Copy, RotateCcw, Search, EyeOff, Send } from 'lucide-react';
import { ProviderSelection } from './components/ProviderSelection';
import { Provider, Session } from './types';

const mockSessions: Session[] = [
  {
    id: '1',
    title: 'AI Ethics Discussion',
    lastUsed: new Date(Date.now() - 1000 * 60 * 30), // 30 minutes ago
    providers: ['chatgpt', 'claude'],
    options: { research: true, incognito: false }
  },
  {
    id: '2',
    title: 'Code Review Best Practices',
    lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    providers: ['chatgpt', 'claude', 'gemini'],
    options: { research: false, incognito: true }
  }
];

const initialProviders: Provider[] = [
  { id: 'chatgpt', name: 'ChatGPT', enabled: true, available: true },
  { id: 'claude', name: 'Claude', enabled: true, available: true },
  { id: 'gemini', name: 'Gemini', enabled: false, available: true },
  { id: 'grok', name: 'Grok', enabled: false, available: true }
];

function App() {
  const [prompt, setPrompt] = useState('');
  const [providers, setProviders] = useState<Provider[]>(initialProviders);
  const [sessionId, setSessionId] = useState('new');
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState({ research: false, incognito: false });
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [status, setStatus] = useState('');
  const [charCount, setCharCount] = useState(0);
  const [isDraftSaved, setIsDraftSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isNewConversation = sessionId === 'new';
  const selectedSession = mockSessions.find(s => s.id === sessionId);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 400) + 'px';
    }
    setCharCount(prompt.length);
  }, [prompt]);

  useEffect(() => {
    if (selectedSession) {
      setProviders(prev => prev.map(p => ({
        ...p,
        enabled: selectedSession.providers.includes(p.id)
      })));
      setOptions(selectedSession.options);
    }
  }, [selectedSession]);

  const handleProviderToggle = (providerId: string) => {
    setProviders(prev => prev.map(p => 
      p.id === providerId ? { ...p, enabled: !p.enabled } : p
    ));
  };

  const handleGenerateTitle = async () => {
    if (!prompt.trim()) return;
    
    setIsGeneratingTitle(true);
    // Simulate API call
    setTimeout(() => {
      setTitle(`AI Discussion: ${prompt.slice(0, 30)}...`);
      setIsGeneratingTitle(false);
    }, 1500);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPrompt(text);
      setStatus('Text pasted from clipboard');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setStatus('Unable to access clipboard');
      setTimeout(() => setStatus(''), 2000);
    }
  };

  const handleClear = () => {
    if (prompt.length > 100) {
      if (confirm('Are you sure you want to clear this prompt?')) {
        setPrompt('');
        setTitle('');
      }
    } else {
      setPrompt('');
      setTitle('');
    }
  };

  const handleSend = () => {
    if (!prompt.trim()) return;
    const enabledProviders = providers.filter(p => p.enabled);
    if (enabledProviders.length === 0) return;
    
    setStatus('Sending to selected providers...');
    // Simulate sending
    setTimeout(() => {
      setStatus('Successfully sent to all providers');
      setTimeout(() => setStatus(''), 3000);
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <div className="logo-icon">
            <Zap className="w-6 h-6" />
          </div>
          <span className="brand-name">LLM Burst</span>
        </div>
        <button className="settings-btn" aria-label="Settings">
          <Settings className="w-5 h-5" />
        </button>
      </header>

      <main className="main-content">
        <div className="session-section">
          <label htmlFor="session-select" className="section-label">Session</label>
          <select 
            id="session-select"
            value={sessionId} 
            onChange={(e) => setSessionId(e.target.value)}
            className="session-select"
          >
            <option value="new">New conversation</option>
            {mockSessions.map(session => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </div>

        <div className="prompt-section">
          <div className="prompt-header">
            <label htmlFor="prompt-input" className="section-label">
              Prompt
              <span className="keyboard-hint">⌘+Enter to send</span>
            </label>
            <div className="prompt-actions">
              {prompt && (
                <button 
                  onClick={handleClear}
                  className="action-btn clear-btn"
                  aria-label="Clear prompt"
                >
                  Clear
                </button>
              )}
              <button 
                onClick={handlePaste}
                className="action-btn paste-btn"
                aria-label="Paste from clipboard"
              >
                <Copy className="w-4 h-4" />
                Paste
              </button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            id="prompt-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Paste or type your prompt..."
            className="prompt-input"
            rows={isNewConversation ? 8 : 12}
          />
          <div className="prompt-footer">
            {charCount > 1000 && (
              <span className="char-count">{charCount.toLocaleString()} / 10,000</span>
            )}
            {isDraftSaved && (
              <span className="draft-status">Draft saved</span>
            )}
          </div>
        </div>

        {isNewConversation && (
          <>
            <div className="options-section">
              <div className="options-grid">
                <label className="option-toggle">
                  <input
                    type="checkbox"
                    checked={options.research}
                    onChange={(e) => setOptions(prev => ({...prev, research: e.target.checked}))}
                  />
                  <div className="toggle-switch">
                    <div className="toggle-slider"></div>
                  </div>
                  <div className="option-content">
                    <Search className="w-4 h-4" />
                    <span>Research</span>
                  </div>
                </label>
                <label className="option-toggle">
                  <input
                    type="checkbox"
                    checked={options.incognito}
                    onChange={(e) => setOptions(prev => ({...prev, incognito: e.target.checked}))}
                  />
                  <div className="toggle-switch">
                    <div className="toggle-slider"></div>
                  </div>
                  <div className="option-content">
                    <EyeOff className="w-4 h-4" />
                    <span>Incognito</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="providers-section">
              <ProviderSelection 
                providers={providers}
                onToggle={handleProviderToggle}
              />
            </div>

            <div className="title-section">
              <div className="title-header">
                <label htmlFor="title-input" className="section-label">Session Title</label>
                <button 
                  onClick={handleGenerateTitle}
                  disabled={!prompt.trim() || isGeneratingTitle}
                  className="action-btn generate-btn"
                  aria-label="Auto-generate title"
                >
                  <RotateCcw className={`w-4 h-4 ${isGeneratingTitle ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <input
                id="title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Auto-generated from prompt..."
                className="title-input"
                maxLength={80}
              />
              {title && (
                <div className="title-footer">
                  <span className="char-count">{title.length} / 80</span>
                </div>
              )}
            </div>
          </>
        )}

        {status && (
          <div className="status-message" role="status" aria-live="polite">
            {status}
          </div>
        )}

        <button 
          onClick={handleSend}
          disabled={!prompt.trim() || !providers.some(p => p.enabled)}
          className="send-button"
        >
          <Send className="w-5 h-5" />
          {isNewConversation ? 'Send' : 'Continue Thread'}
          <span className="keyboard-shortcut">⌘+Enter</span>
        </button>
      </main>
    </div>
  );
}

export default App;