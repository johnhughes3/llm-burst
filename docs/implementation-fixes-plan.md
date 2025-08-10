# LLM-Burst Implementation Fixes & Improvements Plan

## Overview
This document provides a detailed, actionable plan to address critical bugs and implement improvements. Updated after reviewing another model's analysis which identified **showstopper bugs** that must be fixed immediately.

## ⚠️ Phase 0: CRITICAL SHOWSTOPPER FIXES (Must fix first!)

### P0.1: Fix Auto-naming Breaking Follow-up and Grouping (G1)
**Priority**: CRITICAL - System is broken without this  
**Time Estimate**: 4-6 hours  
**Issue**: Auto-naming changes internal `task_name` identifiers, breaking follow-up and toggle-group commands

#### Root Cause:
- `_task_slug()` reconstructs names as `f"{session_title}:{provider.name.lower()}"`
- During activate, auto-namer renames `LiveSession.task_name` to human-friendly title
- Later commands can't find the renamed sessions

#### Implementation:
```python
# In cli_click.py - Decouple internal IDs from display names

def _task_slug(session_title: str, provider: LLMProvider) -> str:
    """Generate stable internal identifier - NEVER rename these."""
    # Use a stable pattern that won't change
    return f"internal_{session_title}_{provider.name.lower()}"

# In auto_namer.py - Only update display names, not internal IDs

async def suggest_task_name(page: Page, provider: LLMProvider) -> Optional[str]:
    """Extract conversation and suggest name WITHOUT mutating state."""
    conversation = await extract_conversation(page, provider)
    if not conversation:
        return None
    return await generate_task_name(conversation, model)

# In cmd_activate - Update only session title, not per-tab names
async def _async_activate() -> tuple[list[str], str]:
    # ... existing code ...
    
    # Get name suggestion from first provider
    suggested_name = None
    for prov in providers:
        if not suggested_name:
            suggested_name = await suggest_task_name(handle.page, prov)
    
    # Update ONLY the MultiProviderSession title, not LiveSession task_names
    if auto_generated and suggested_name:
        # Rename session-level only
        if state.rename_session(session_title, suggested_name):
            session_title = suggested_name
            # Update browser tab titles for display
            for handle in handles:
                await set_window_title(handle.page, suggested_name)
```

### P0.2: Implement Ungroup Functionality (G2)
**Priority**: CRITICAL - Core feature missing  
**Time Estimate**: 3-4 hours  
**Issue**: `toggle-group` sends `_ungroup_` placeholder but no implementation exists

#### Implementation:
```python
# In browser.py - Add ungroup method

async def ungroup_task(self, task_name: str) -> bool:
    """Remove a task from its tab group."""
    session = self._state.get(task_name)
    if not session or session.group_id is None:
        return False
    
    cdp = await self._get_cdp_connection()
    if not cdp:
        return False
    
    try:
        # Move tab out of group (Chrome doesn't have explicit ungroup)
        # We can move it to a new window or reset its group
        await cdp.send("Browser.setWindowBounds", {
            "windowId": session.window_id,
            "bounds": {"windowState": "normal"}
        })
        
        # Clear group_id in state
        session.group_id = None
        self._state.assign_session_to_group(task_name, None)
        return True
    except Exception as e:
        _LOG.error(f"Failed to ungroup {task_name}: {e}")
        return False

# In cli_click.py - Fix toggle-group ungroup branch

if sess.grouped:
    # Properly ungroup each tab
    for prov in sess.tabs:
        task = _task_slug(session_title, prov)
        success = asyncio.run(adapter.ungroup_task(task))
        if not success:
            click.echo(f"Failed to ungroup {prov.name}", err=True)
    state.set_grouped(session_title, False)
```

### P0.3: Fix ChatGPT URL (G3)
**Priority**: CRITICAL - Wrong URL breaks model selection  
**Time Estimate**: 30 minutes  

```python
# In constants.py
LLM_URLS: Final[dict[LLMProvider, str]] = {
    LLMProvider.GEMINI: "https://gemini.google.com/app",
    LLMProvider.CLAUDE: "https://claude.ai/new",
    LLMProvider.CHATGPT: "https://chatgpt.com/?model=o3-pro",  # ← FIXED
    LLMProvider.GROK: "https://grok.com",
}
```

### P0.4: Fix CDP Session Private Attribute Usage (G4)
**Priority**: CRITICAL - Breaks across Playwright versions  
**Time Estimate**: 1 hour  

```python
# In tab_groups.py - Replace private attribute usage

async def _async_create_group(name: str, color: str) -> TabGroup:
    async with BrowserAdapter() as adapter:
        # Get CDP session properly
        cdp = await adapter._get_cdp_connection()
        if not cdp:
            raise RuntimeError("No CDP connection available")
        
        # DON'T use: adapter._browser.contexts[0]._connection
        # Use the proper CDP session instead
        
        # ... rest of implementation
```

## Phase 1: Critical Error Handling Improvements (1-2 days)

### Task 1.1: Add Error Boundaries to JavaScript Functions
**Priority**: High  
**Time Estimate**: 4 hours

#### Files to Modify:
- `llm_burst/sites/gemini.py`
- `llm_burst/sites/claude.py`
- `llm_burst/sites/chatgpt.py`
- `llm_burst/sites/grok.py`

#### Implementation Steps:

1. **Wrap all async functions with try-catch blocks**
```javascript
// Template for each provider's main functions
window.automateProviderChat = async function(messageText, options) {
  try {
    // Set up error context
    const errorContext = { provider: 'PROVIDER_NAME', action: 'initial_submit' };
    
    // Existing implementation...
    
  } catch (error) {
    console.error(`[${errorContext.provider}] Error in ${errorContext.action}:`, error);
    // Attempt recovery or graceful degradation
    return handleProviderError(error, errorContext);
  }
}
```

2. **Add handleProviderError helper function**
```javascript
window.handleProviderError = function(error, context) {
  // Log detailed error information
  const errorReport = {
    timestamp: new Date().toISOString(),
    provider: context.provider,
    action: context.action,
    error: error.message,
    stack: error.stack,
    userAgent: navigator.userAgent
  };
  
  // Store error for debugging
  window.llmBurstErrors = window.llmBurstErrors || [];
  window.llmBurstErrors.push(errorReport);
  
  // Return structured error for Python layer
  return {
    success: false,
    error: error.message,
    recoverable: isRecoverableError(error),
    context: context
  };
}
```

3. **Add timeout wrappers for all wait operations**
```javascript
window.waitWithTimeout = function(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    )
  ]);
}
```

### Task 1.2: Enhance Python-JavaScript Error Communication
**Priority**: High  
**Time Estimate**: 2 hours

#### Files to Modify:
- `llm_burst/providers/__init__.py`

#### Implementation:
```python
async def _inject(page: Page, prompt: str, opts: "InjectOptions") -> None:
    try:
        # ... existing code ...
        
        # Enhanced error handling
        result = await page.evaluate(
            f"(async () => {{ "
            f"  const result = await {call_expr}; "
            f"  return {{ success: true, data: result }}; "
            f"}})().catch(e => ({{ "
            f"  success: false, "
            f"  error: e.message || String(e), "
            f"  stack: e.stack "
            f"}}))"
        )
        
        if not result.get('success', False):
            _LOG.error(f"JavaScript execution failed: {result.get('error')}")
            if result.get('stack'):
                _LOG.debug(f"Stack trace: {result.get('stack')}")
            raise RuntimeError(f"Provider automation failed: {result.get('error')}")
            
    except Exception as e:
        _LOG.error(f"Failed to inject {provider} automation: {e}")
        raise
```

## Phase 2: Selector Resilience System (2-3 days)

### Task 2.1: Implement Selector Health Check System
**Priority**: Medium  
**Time Estimate**: 4 hours

#### New File:
- `llm_burst/selector_health.py`

```python
"""Selector health monitoring and update system."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import async_playwright

from .constants import LLMProvider, LLM_URLS

_LOG = logging.getLogger(__name__)

@dataclass
class SelectorStatus:
    provider: LLMProvider
    selector: str
    description: str
    is_valid: bool
    last_checked: datetime
    error_message: Optional[str] = None

class SelectorHealthMonitor:
    """Monitor and report on selector health across providers."""
    
    def __init__(self):
        self._status_cache: Dict[LLMProvider, List[SelectorStatus]] = {}
        self._last_full_check: Optional[datetime] = None
        
    async def check_all_providers(self) -> Dict[LLMProvider, List[SelectorStatus]]:
        """Check selectors for all providers."""
        results = {}
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            
            for provider in LLMProvider:
                try:
                    results[provider] = await self._check_provider(browser, provider)
                except Exception as e:
                    _LOG.error(f"Failed to check {provider}: {e}")
                    results[provider] = []
            
            await browser.close()
        
        self._status_cache = results
        self._last_full_check = datetime.now()
        return results
    
    async def _check_provider(self, browser, provider: LLMProvider) -> List[SelectorStatus]:
        """Check selectors for a specific provider."""
        page = await browser.new_page()
        await page.goto(LLM_URLS[provider], wait_until="domcontentloaded")
        
        # Provider-specific selector checks
        selector_checks = self._get_provider_selectors(provider)
        results = []
        
        for selector, description in selector_checks:
            try:
                element = await page.query_selector(selector)
                is_valid = element is not None
                results.append(SelectorStatus(
                    provider=provider,
                    selector=selector,
                    description=description,
                    is_valid=is_valid,
                    last_checked=datetime.now(),
                    error_message=None if is_valid else "Selector not found"
                ))
            except Exception as e:
                results.append(SelectorStatus(
                    provider=provider,
                    selector=selector,
                    description=description,
                    is_valid=False,
                    last_checked=datetime.now(),
                    error_message=str(e)
                ))
        
        await page.close()
        return results
    
    def _get_provider_selectors(self, provider: LLMProvider) -> List[tuple[str, str]]:
        """Get selectors to check for each provider."""
        selectors = {
            LLMProvider.GEMINI: [
                ('.ql-editor', 'Main text editor'),
                ('button.send-button', 'Send button'),
                ('button.toolbox-drawer-item-button', 'Deep Research button'),
            ],
            LLMProvider.CLAUDE: [
                ('.ProseMirror', 'Main text editor'),
                ('button[aria-label="Send message"]', 'Send button'),
                ('button:has-text("Research")', 'Research mode button'),
            ],
            LLMProvider.CHATGPT: [
                ('#prompt-textarea', 'Main text input'),
                ('button[data-testid="send-button"]', 'Send button'),
                ('#system-hint-button', 'Tools dropdown'),
            ],
            LLMProvider.GROK: [
                ('textarea[aria-label="Ask Grok anything"]', 'Text input'),
                ('[contenteditable="true"]', 'ContentEditable input'),
                ('button[type="submit"]', 'Submit button'),
            ],
        }
        return selectors.get(provider, [])
    
    def generate_report(self) -> str:
        """Generate a human-readable report of selector health."""
        if not self._status_cache:
            return "No health check data available. Run check_all_providers() first."
        
        report = []
        report.append(f"Selector Health Report - {datetime.now().isoformat()}")
        report.append("=" * 60)
        
        for provider, statuses in self._status_cache.items():
            report.append(f"\n{provider.name}:")
            for status in statuses:
                symbol = "✅" if status.is_valid else "❌"
                report.append(f"  {symbol} {status.description}: {status.selector}")
                if status.error_message:
                    report.append(f"      Error: {status.error_message}")
        
        return "\n".join(report)
```

### Task 2.2: Add Selector Update Notification
**Priority**: Medium  
**Time Estimate**: 2 hours

#### Add to existing CLI:
```python
@cli.command("check-selectors")
@click.option("--notify", is_flag=True, help="Send notification if selectors break")
def cmd_check_selectors(notify: bool) -> None:
    """Check if UI selectors are still valid."""
    from llm_burst.selector_health import SelectorHealthMonitor
    
    monitor = SelectorHealthMonitor()
    results = asyncio.run(monitor.check_all_providers())
    
    # Print report
    click.echo(monitor.generate_report())
    
    # Check for failures
    failures = []
    for provider, statuses in results.items():
        failed = [s for s in statuses if not s.is_valid]
        if failed:
            failures.extend(failed)
    
    if failures and notify:
        # Send notification (could be email, Slack, etc.)
        click.echo(f"\n⚠️  {len(failures)} selectors are broken!")
        click.echo("Run 'llm-burst update-selectors' to see fix suggestions.")
    
    sys.exit(1 if failures else 0)
```

## Phase 3: Enhanced Retry & Recovery (1 day)

### Task 3.1: Implement Exponential Backoff
**Priority**: Medium  
**Time Estimate**: 2 hours

#### New utility module:
- `llm_burst/retry_utils.py`

```python
"""Retry utilities with exponential backoff."""

import asyncio
import random
from typing import TypeVar, Callable, Optional, Any
from functools import wraps

T = TypeVar('T')

class RetryConfig:
    """Configuration for retry behavior."""
    
    def __init__(
        self,
        max_attempts: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        exponential_base: float = 2.0,
        jitter: bool = True,
    ):
        self.max_attempts = max_attempts
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.exponential_base = exponential_base
        self.jitter = jitter
    
    def get_delay(self, attempt: int) -> float:
        """Calculate delay for given attempt number."""
        delay = min(
            self.base_delay * (self.exponential_base ** attempt),
            self.max_delay
        )
        if self.jitter:
            delay *= (0.5 + random.random())
        return delay

def with_retry(config: Optional[RetryConfig] = None):
    """Decorator to add retry logic to async functions."""
    if config is None:
        config = RetryConfig()
    
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            last_exception = None
            
            for attempt in range(config.max_attempts):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < config.max_attempts - 1:
                        delay = config.get_delay(attempt)
                        _LOG.warning(
                            f"Attempt {attempt + 1} failed for {func.__name__}: {e}. "
                            f"Retrying in {delay:.1f}s..."
                        )
                        await asyncio.sleep(delay)
                    else:
                        _LOG.error(
                            f"All {config.max_attempts} attempts failed for {func.__name__}"
                        )
            
            raise last_exception
        
        return wrapper
    return decorator
```

### Task 3.2: Apply Retry Logic to Critical Operations
**Priority**: Medium  
**Time Estimate**: 2 hours

#### Modify browser.py:
```python
from .retry_utils import with_retry, RetryConfig

class BrowserAdapter:
    # ... existing code ...
    
    @with_retry(RetryConfig(max_attempts=3, base_delay=2.0))
    async def _ensure_connection(self) -> None:
        """Attach to Chrome with retry logic."""
        # ... existing implementation ...
    
    @with_retry(RetryConfig(max_attempts=5, base_delay=0.5))
    async def _find_page_for_target(self, target_id: str) -> Optional[Page]:
        """Find page with enhanced retry."""
        # ... existing implementation ...
```

## Phase 4: Configuration System (1 day)

### Task 4.1: Create User Configuration File
**Priority**: Low  
**Time Estimate**: 3 hours

#### New file:
- `llm_burst/config.py`

```python
"""User configuration management."""

import os
import json
from pathlib import Path
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict

@dataclass
class LLMBurstConfig:
    """User configuration for llm-burst."""
    
    # Browser settings
    chrome_remote_port: int = 9222
    chrome_executable: str = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    chrome_profile_dir: Optional[str] = None
    auto_relaunch_chrome: bool = False
    
    # Timeouts (in seconds)
    page_load_timeout: float = 30.0
    element_wait_timeout: float = 10.0
    submission_timeout: float = 60.0
    
    # Retry settings
    max_retry_attempts: int = 3
    retry_base_delay: float = 1.0
    
    # Auto-naming
    auto_naming_enabled: bool = True
    gemini_api_key: Optional[str] = None
    
    # Logging
    log_level: str = "INFO"
    log_file: Optional[str] = None
    
    # Debug options
    debug_mode: bool = False
    save_screenshots_on_error: bool = False
    
    @classmethod
    def load(cls) -> "LLMBurstConfig":
        """Load configuration from file or environment."""
        config_path = Path.home() / ".config" / "llm-burst" / "config.json"
        
        # Start with defaults
        config = cls()
        
        # Load from file if exists
        if config_path.exists():
            try:
                with open(config_path) as f:
                    data = json.load(f)
                    for key, value in data.items():
                        if hasattr(config, key):
                            setattr(config, key, value)
            except Exception as e:
                _LOG.warning(f"Failed to load config: {e}")
        
        # Override with environment variables
        env_mappings = {
            "CHROME_REMOTE_PORT": "chrome_remote_port",
            "GOOGLE_CHROME": "chrome_executable",
            "GOOGLE_CHROME_PROFILE_DIR": "chrome_profile_dir",
            "LLM_BURST_AUTO_RELAUNCH_CHROME": "auto_relaunch_chrome",
            "GEMINI_API_KEY": "gemini_api_key",
            "LLM_BURST_DEBUG": "debug_mode",
        }
        
        for env_var, config_key in env_mappings.items():
            value = os.environ.get(env_var)
            if value is not None:
                # Convert to appropriate type
                current_type = type(getattr(config, config_key))
                if current_type == bool:
                    value = value.lower() in ("1", "true", "yes")
                elif current_type == int:
                    value = int(value)
                elif current_type == float:
                    value = float(value)
                setattr(config, config_key, value)
        
        return config
    
    def save(self, path: Optional[Path] = None) -> None:
        """Save configuration to file."""
        if path is None:
            path = Path.home() / ".config" / "llm-burst" / "config.json"
        
        path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(path, 'w') as f:
            json.dump(asdict(self), f, indent=2)

# Global config instance
_config: Optional[LLMBurstConfig] = None

def get_config() -> LLMBurstConfig:
    """Get the global configuration instance."""
    global _config
    if _config is None:
        _config = LLMBurstConfig.load()
    return _config
```

## Phase 5: Testing & Validation (1 day)

### Task 5.1: Add Integration Tests for Error Handling
**Priority**: High  
**Time Estimate**: 3 hours

#### New test file:
- `tests/test_error_handling.py`

```python
"""Test error handling and recovery mechanisms."""

import pytest
from unittest.mock import Mock, patch
from playwright.async_api import Error as PlaywrightError

from llm_burst.providers import get_injector, InjectOptions
from llm_burst.constants import LLMProvider

@pytest.mark.asyncio
async def test_javascript_error_handling():
    """Test that JavaScript errors are properly caught and reported."""
    mock_page = Mock()
    mock_page.evaluate = Mock(side_effect=Exception("JavaScript execution failed"))
    
    injector = get_injector(LLMProvider.GEMINI)
    opts = InjectOptions(follow_up=False, research=False)
    
    with pytest.raises(RuntimeError) as exc_info:
        await injector(mock_page, "test prompt", opts)
    
    assert "JavaScript execution failed" in str(exc_info.value)

@pytest.mark.asyncio  
async def test_retry_on_network_failure():
    """Test retry logic for network failures."""
    from llm_burst.retry_utils import with_retry, RetryConfig
    
    attempt_count = 0
    
    @with_retry(RetryConfig(max_attempts=3, base_delay=0.1))
    async def flaky_operation():
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count < 3:
            raise ConnectionError("Network error")
        return "success"
    
    result = await flaky_operation()
    assert result == "success"
    assert attempt_count == 3

@pytest.mark.asyncio
async def test_selector_fallback():
    """Test that selector fallbacks work correctly."""
    mock_page = Mock()
    
    # Simulate first selector failing, second succeeding
    mock_page.query_selector = Mock(side_effect=[None, Mock()])
    
    # Test should use fallback selector
    # ... implementation specific to each provider
```

### Task 5.2: Add Monitoring & Metrics
**Priority**: Low  
**Time Estimate**: 2 hours

#### New module:
- `llm_burst/metrics.py`

```python
"""Performance metrics and monitoring."""

import time
from contextlib import contextmanager
from typing import Dict, List
from dataclasses import dataclass, field
from datetime import datetime

@dataclass
class OperationMetric:
    """Metric for a single operation."""
    operation: str
    start_time: float
    end_time: float = 0.0
    success: bool = False
    error: str = ""
    
    @property
    def duration(self) -> float:
        """Duration in seconds."""
        return self.end_time - self.start_time if self.end_time else 0.0

class MetricsCollector:
    """Collect and report performance metrics."""
    
    def __init__(self):
        self._metrics: List[OperationMetric] = []
    
    @contextmanager
    def measure(self, operation: str):
        """Context manager to measure operation time."""
        metric = OperationMetric(
            operation=operation,
            start_time=time.time()
        )
        
        try:
            yield metric
            metric.success = True
        except Exception as e:
            metric.success = False
            metric.error = str(e)
            raise
        finally:
            metric.end_time = time.time()
            self._metrics.append(metric)
    
    def get_summary(self) -> Dict:
        """Get summary statistics."""
        if not self._metrics:
            return {}
        
        total_duration = sum(m.duration for m in self._metrics)
        success_count = sum(1 for m in self._metrics if m.success)
        
        return {
            "total_operations": len(self._metrics),
            "successful": success_count,
            "failed": len(self._metrics) - success_count,
            "total_duration": total_duration,
            "average_duration": total_duration / len(self._metrics),
            "operations": [
                {
                    "name": m.operation,
                    "duration": m.duration,
                    "success": m.success,
                    "error": m.error
                }
                for m in self._metrics
            ]
        }

# Global metrics instance
_metrics = MetricsCollector()

def get_metrics() -> MetricsCollector:
    """Get the global metrics collector."""
    return _metrics
```

## Revised Implementation Schedule

### IMMEDIATE (Day 1-2)
- **Day 1**: Phase 0 - P0.1 Fix auto-naming architecture bug
- **Day 1**: Phase 0 - P0.3 Fix ChatGPT URL  
- **Day 2**: Phase 0 - P0.2 Implement ungroup
- **Day 2**: Phase 0 - P0.4 Fix CDP session usage

### Week 1 (After Critical Fixes)
- **Day 3-4**: Phase 1 - Critical Error Handling
- **Day 5**: Phase 2 - Begin Selector Resilience System

### Week 2  
- **Day 1-2**: Phase 2 - Complete Selector Resilience
- **Day 3**: Phase 3 - Retry & Recovery
- **Day 4**: Phase 4 - Configuration System
- **Day 5**: Phase 5 - Testing & Validation

### Week 3
- **Day 1-2**: Integration testing of all fixes
- **Day 3**: Documentation updates
- **Day 4-5**: Final validation and release

## Success Metrics

1. **Error Rate**: < 1% failure rate for standard operations
2. **Selector Stability**: 95% of selectors remain valid for 30+ days
3. **Recovery Success**: 90% of transient failures recovered automatically
4. **Performance**: Average operation time < 5 seconds
5. **Test Coverage**: > 90% code coverage maintained

## Risk Mitigation

1. **UI Changes**: Daily selector health checks with notifications
2. **Network Issues**: Exponential backoff with configurable retries
3. **Browser Crashes**: Automatic browser restart with state recovery
4. **API Changes**: Version detection and compatibility warnings

## Conclusion

This revised implementation plan incorporates critical architectural bugs identified in a secondary review that were missed in the initial analysis. The Phase 0 fixes are **showstoppers** that must be addressed immediately before any other improvements:

1. **Auto-naming breaking follow-up/grouping** - Critical design flaw
2. **Missing ungroup functionality** - Core feature gap
3. **Wrong ChatGPT URL** - Breaks model selection
4. **Private CDP API usage** - Fragility issue

These critical fixes add 2 days to the timeline but are essential for a functioning system. The remaining phases provide important robustness improvements but are secondary to fixing these core issues.

**Revised total estimated time: 12-15 working days**

### Acknowledgment
Credit to the secondary review (implementation_review.md) for identifying the critical Phase 0 issues that represent fundamental architectural problems rather than mere enhancements.