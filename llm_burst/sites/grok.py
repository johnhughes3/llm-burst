"""Grok site automation JavaScript selectors and functions.

This file was generated automatically from the Grok blocks stored in the
Keyboard-Maestro macros (LLMs Activate / LLMs Follow Up).  The JavaScript is
kept verbatim so that it can be injected into the browser without further
transformation.
"""

# --------------------------------------------------------------------------- #
#  INITIAL SUBMIT (first prompt)                                              #
# --------------------------------------------------------------------------- #

SUBMIT_JS = r"""// Grok Automation Script - Ultimate Version v1.0
// ----------------------------------------------------------------------------
// This script automates Grok chat with support for:
//   - DeeperSearch/Research mode
//   - Incognito/Private Chat mode
//   - Natural text input with fallbacks
//
// Keyboard Maestro Variables:
//   kmvar.PromptText - The message to send
//   kmvar.Research   - "Yes" | "No" for DeeperSearch mode
//   kmvar.Incognito  - "Yes" | "No" for Private Chat mode
// ----------------------------------------------------------------------------

// === Compatibility aliases (added by llm-burst) =============================
const wait      = (...args) => window.llmBurstWait(...args);
const waitUntil = (...args) => window.llmBurstWaitUntil(...args);
// =============================================================================

/**
 * Main Grok automation function
 * @param {string} promptText - The text to send to Grok
 * @param {string} researchMode - "Yes" or "No" for DeeperSearch mode
 * @param {string} incognitoMode - "Yes" or "No" for Private Chat mode
 * @returns {Promise<string>} Success or error message
 */
window.automateGrokChat = async function(promptText, researchMode, incognitoMode) {
  console.log(`Starting Grok automation: Research=${researchMode}, Incognito=${incognitoMode}`);
  
  try {
    // Step 1: Set operational modes before text input
    await configureChatModes(researchMode, incognitoMode);
    
    // Step 2: Text input and submission
    await sendPromptToGrok(promptText);
    
    console.log("✅ Grok automation completed successfully");
    return "SUCCESS"; // For Keyboard Maestro result handling
  } catch (error) {
    console.error(`❌ Grok automation failed: ${error.message}`);
    return `ERROR: ${error.message}`; // Structured error for KM
  }
}

// =============================================================================
//  MODE CONFIGURATION - Handles DeeperSearch, Think, and Incognito modes
// =============================================================================

/**
 * Configures all chat modes in the correct sequence
 * @param {string} research - "Yes" or "No" for DeeperSearch mode
 * @param {string} incognito - "Yes" or "No" for Private Chat mode
 */
async function configureChatModes(research, incognito) {
  console.log(`Configuring chat modes: Research=${research}, Incognito=${incognito}`);
  
  // Step 1: Handle Incognito mode if requested (independent of other modes)
  if (incognito === "Yes") {
    const incognitoResult = await enableIncognitoMode();
    if (!incognitoResult) {
      console.warn("⚠️ Incognito button not found or activation failed - continuing without Private Chat");
    }
    await wait(300); // Allow UI to update
  }

  // Step 2: Configure the appropriate research/thinking mode
  if (research === "Yes") {
    try {
      console.log("Research mode requested - activating DeeperSearch...");
      await enableDeeperSearch();
      console.log("✓ DeeperSearch mode activated successfully");
    } catch (error) {
      console.warn(`⚠️ DeeperSearch activation failed: ${error.message} - falling back to Think mode`);
      await enableThinkMode();
    }
  } else {
    console.log("Standard mode - activating Think...");
    await enableThinkMode();
  }
  
  // Allow UI to stabilize after mode changes
  await wait(300);
}

/**
 * Enables Private Chat (Incognito) mode
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function enableIncognitoMode() {
  console.log("Attempting to enable Private Chat mode...");
  
  try {
    // Find button with multiple selectors for reliability
    const button = await waitUntil(() => (
      document.querySelector('[aria-label="Switch to Private Chat"]') ||
      document.querySelector('button[title*="Private Chat" i]') ||
      document.querySelector('button[aria-description*="Private Chat" i]')
    ), 2000, 100);
    
    if (!button) {
      console.warn("Private Chat button not found");
      return false;
    }
    
    // Use full click sequence for reliability
    window.simulateButtonClick(button);
    
    // Verify state change if possible
    const stateCheck = button.getAttribute('aria-pressed') !== null;
    if (stateCheck) {
      await waitUntil(() => button.getAttribute('aria-pressed') === 'true', 1000, 100)
        .catch(() => console.warn("Could not verify Private Chat state change"));
    }
    
    console.log("✓ Private Chat mode enabled");
    return true;
  } catch (error) {
    console.warn(`Private Chat error: ${error.message}`);
    return false;
  }
}

/**
 * Enables DeeperSearch mode through the dropdown menu
 * @throws {Error} If the dropdown or DeeperSearch option cannot be found/activated
 */
async function enableDeeperSearch() {
  try {
    // Step 1: Find and open the mode dropdown
    const dropdown = await findModeDropdown();
    if (!dropdown) {
      throw new Error("Mode dropdown not found");
    }
    
    // Step 2: Open dropdown if not already open
    const isOpen = dropdown.getAttribute("aria-expanded") === "true";
    if (!isOpen) {
      await openModeDropdown(dropdown);
    }
    
    // Step 3: Find and click the DeeperSearch option
    const option = await findDeeperSearchOption();
    if (!option) {
      // Try to close dropdown before erroring
      if (!isOpen && dropdown.getAttribute("aria-expanded") === "true") {
        dropdown.click();
      }
      throw new Error("DeeperSearch option not found in dropdown");
    }
    
    // Step 4: Check if already selected, click if needed
    const alreadyActive = option.getAttribute("aria-checked") === "true";
    if (alreadyActive) {
      console.log("DeeperSearch already active - no action needed");
    } else {
      await activateDeeperSearchOption(option);
    }
    
    // Step 5: Close dropdown if we opened it
    if (!isOpen && dropdown.getAttribute("aria-expanded") === "true") {
      dropdown.click();
      await wait(100);
    }
  } catch (error) {
    throw new Error(`DeeperSearch activation failed: ${error.message}`);
  }
}

/**
 * Finds the mode dropdown button
 * @returns {Promise<Element|null>} The dropdown button or null if not found
 */
async function findModeDropdown() {
  return waitUntil(() => (
    document.querySelector('button[aria-label="Change mode"]') ||
    document.querySelector('button[aria-haspopup="menu"][aria-controls*="dropdown"]') ||
    Array.from(document.querySelectorAll('button[aria-haspopup="menu"]'))
      .find(btn => btn.textContent && /mode|search|deeper/i.test(btn.textContent))
  ), 2000, 100).catch(() => null);
}

/**
 * Opens the mode dropdown with proper event sequence
 * @param {Element} dropdown - The dropdown button element
 */
async function openModeDropdown(dropdown) {
  console.log("Opening mode dropdown");
  
  // Use pointerdown first for more reliable dropdown opening
  dropdown.dispatchEvent(new PointerEvent("pointerdown", { 
    bubbles: true, cancelable: true, view: window 
  }));
  
  // Standard click after pointerdown
  dropdown.click();
  
  // Wait for dropdown to open by checking aria-expanded attribute
  await waitUntil(
    () => dropdown.getAttribute("aria-expanded") === "true",
    1000, 50
  ).catch(() => console.warn("Dropdown didn't report as expanded, proceeding anyway"));
  
  // Give time for menu items to render
  await wait(300);
}

/**
 * Finds the DeeperSearch option in the dropdown menu
 * @returns {Promise<Element|null>} The DeeperSearch option or null if not found
 */
async function findDeeperSearchOption() {
  return waitUntil(() => {
    // Try multiple selectors for maximum reliability
    const menuItems = document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"]');
    return Array.from(menuItems).find(item => {
      const text = item.textContent || "";
      return text.includes("DeeperSearch") || text.includes("Deeper Search");
    });
  }, 2000, 100).catch(() => null);
}

/**
 * Activates the DeeperSearch option with proper event sequence and verification
 * @param {Element} option - The DeeperSearch menu option element
 */
async function activateDeeperSearchOption(option) {
  console.log("Activating DeeperSearch option");
  
  // Find the best click target (specific span if available, or main element)
  const clickTarget = 
    option.querySelector('.text-secondary') || 
    option.querySelector('span:nth-child(2)') || 
    option;
  
  // Use full sequence for reliable clicking
  window.simulateButtonClick(clickTarget);
  
  // Verify selection worked by checking aria-checked (with timeout)
  await waitUntil(
    () => option.getAttribute("aria-checked") === "true",
    1500, 100
  ).catch(() => console.warn("DeeperSearch selection not confirmed via aria-checked attribute"));
}

/**
 * Enables Think mode for standard operation
 * @returns {Promise<boolean>} True if successful or unavailable, false if failed
 */
async function enableThinkMode() {
  try {
    // Find Think button with multiple selector strategies
    const thinkButton = await waitUntil(() => (
      document.querySelector('button[aria-label="Think"]') ||
      document.querySelector('button[data-testid="think-button"]') ||
      document.querySelector('button[title="Think"]') ||
      Array.from(document.querySelectorAll('button')).find(btn => {
        const text = (btn.textContent || "").trim();
        return (text === "Think" || text === "") && 
               btn.querySelector('svg path[d*="M19"]');
      })
    ), 2000, 100).catch(() => null);
    
    if (!thinkButton) {
      console.log("Think button not found - continuing with default mode");
      return true; // Not finding the button is fine - it might be default
    }
    
    // Check if already pressed
    const isPressed = thinkButton.getAttribute("aria-pressed") === "true";
    if (isPressed) {
      console.log("Think mode already active");
      return true;
    }
    
    // Click with full event sequence
    console.log("Clicking Think button");
    window.simulateButtonClick(thinkButton);
    
    // Wait for button state to update
    await waitUntil(
      () => thinkButton.getAttribute("aria-pressed") === "true",
      1000, 50
    ).catch(() => console.warn("Think button pressed but state change not confirmed"));
    
    console.log("✓ Think mode enabled");
    return true;
  } catch (error) {
    console.warn(`Think mode error: ${error.message}`);
    return false; // Continue even if think mode fails
  }
}

// =============================================================================
//  TEXT INPUT AND SUBMISSION - Handles textarea interaction and form submission
// =============================================================================

/**
 * Handles prompt input and submission
 * @param {string} messageText - The text to send to Grok
 * @throws {Error} If text input or submission fails
 */
async function sendPromptToGrok(messageText) {
  console.log("Sending prompt to Grok...");
  
  // Step 1: Find and prepare input element (textarea or contenteditable)
  const inputElement = await findAndPrepareTextarea();
  if (!inputElement) {
    throw new Error("Input element not found or couldn't be prepared");
  }
  
  // Step 2: Input text with appropriate method
  await executeTextInput(inputElement, messageText);
  
  // Step 3: Verify text was accepted
  const textAccepted = await verifyTextInputAccepted(inputElement, messageText);
  if (!textAccepted) {
    throw new Error("Text input verification failed");
  }
  
  // Step 4: Find and click submit button
  await clickSubmitButton(inputElement);
  
  console.log("✓ Prompt successfully sent");
}

/**
 * Finds the input element (textarea or contenteditable) and prepares it for input
 * @returns {Promise<Element|null>} The input element or null if not found
 */
async function findAndPrepareTextarea() {
  console.log("Finding and preparing input element...");
  
  try {
    // Find input element with multiple selectors - prioritize textarea before contenteditable
    const inputElement = await waitUntil(() => (
      document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"]') ||  // Fallback: contenteditable
      document.querySelector('.ProseMirror[contenteditable="true"]')  // Fallback: specific selector
    ), 3000, 100);
    
    if (!inputElement) {
      console.error("Input element not found");
      return null;
    }
    
    // Check if it's a contenteditable div or textarea
    const isContentEditable = inputElement.getAttribute('contenteditable') === 'true';
    console.log(`Found ${isContentEditable ? 'contenteditable div' : 'textarea'}`);
    
    // Ensure element is visible and enabled
    const isVisible = inputElement.offsetParent !== null;
    const isEnabled = isContentEditable ? true : !inputElement.disabled;
    
    if (!isVisible || !isEnabled) {
      console.error("Input element found but not visible or enabled");
      return null;
    }
    
    // Prepare by focusing with full event sequence
    window.simulateFocusSequence(inputElement);
    await wait(100); // Brief pause after focus
    
    return inputElement;
  } catch (error) {
    console.error(`Error finding input element: ${error.message}`);
    return null;
  }
}

/**
 * Executes text input for both textarea and contenteditable elements
 * @param {Element} inputElement - The textarea or contenteditable element
 * @param {string} text - The text to input
 */
async function executeTextInput(inputElement, text) {
  console.log(`Inputting text (${text.length} chars)...`);
  
  const isContentEditable = inputElement.getAttribute('contenteditable') === 'true';
  
  try {
    if (isContentEditable) {
      // For contenteditable, we need to type the text
      // First clear any existing content
      inputElement.textContent = '';
      
      // Use keyboard API to type the text
      for (const char of text) {
        inputElement.dispatchEvent(new KeyboardEvent('keydown', {
          key: char,
          bubbles: true,
          cancelable: true
        }));
        
        // Insert the character
        const currentText = inputElement.textContent || '';
        inputElement.textContent = currentText + char;
        
        // Dispatch input event for each character
        inputElement.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char
        }));
        
        inputElement.dispatchEvent(new KeyboardEvent('keyup', {
          key: char,
          bubbles: true,
          cancelable: true
        }));
      }
      
      // Move cursor to end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(inputElement);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // Simplified textarea logic
      // Clear the textarea value
      inputElement.value = '';
      
      // Set the textarea value directly
      inputElement.value = text;
      
      // Dispatch a single input event
      inputElement.dispatchEvent(new InputEvent("input", { 
        bubbles: true,
        cancelable: true, 
        inputType: "insertText", 
        data: text 
      }));
      
      // Position cursor at end
      inputElement.selectionStart = inputElement.selectionEnd = text.length;
    }
    
    await wait(50); // Brief pause after input sequence
  } catch (error) {
    console.error(`Error during text input: ${error.message}`);
    throw error;
  }
}

/**
 * Verifies text input was accepted, supporting both textarea and contenteditable
 * @param {Element} inputElement - The textarea or contenteditable element
 * @param {string} expectedText - The text that should be in the element
 * @returns {Promise<boolean>} True if verification succeeds
 */
async function verifyTextInputAccepted(inputElement, expectedText) {
  console.log("Verifying text input was accepted...");
  
  const isContentEditable = inputElement.getAttribute('contenteditable') === 'true';
  
  return new Promise(async (resolve) => {
    let attempts = 0;
    const maxAttempts = 5;
    
    const checkStatus = async () => {
      // Check if the element has the expected text
      const actualText = isContentEditable ? 
        (inputElement.textContent || '').trim() : 
        inputElement.value;
      const valueCorrect = actualText === expectedText;
      
      // For contenteditable, just check if text is present
      if (isContentEditable) {
        if (valueCorrect) {
          console.log("✓ Text input accepted in contenteditable");
          resolve(true);
          return;
        }
      } else {
        // Original textarea verification logic
        const placeholderSelectors = [
          'span.pointer-events-none', 
          'span.text-fg-secondary.pointer-events-none',
          'span[aria-hidden="true"]'
        ];
        
        // Check for placeholder visibility (hidden means React accepted the input)
        const parent = inputElement.parentElement;
        if (!parent) {
          resolve(valueCorrect);
          return;
        }
        
        let placeholderHidden = true;
        for (const selector of placeholderSelectors) {
          const placeholder = parent.querySelector(selector);
          if (placeholder) {
            placeholderHidden = placeholder.classList.contains("hidden") || 
                               placeholder.style.display === "none" ||
                               placeholder.getAttribute("aria-hidden") === "true";
            if (!placeholderHidden) break;
          }
        }
        
        if (valueCorrect && placeholderHidden) {
          console.log("✓ Text input accepted by React");
          resolve(true);
          return;
        }
      }
      
      // Try fallback if attempts exhausted
      attempts++;
      if (attempts >= maxAttempts) {
        if (!isContentEditable) {
          console.warn("React did not accept input, trying execCommand fallback...");
          
          try {
            inputElement.focus();
            inputElement.value = '';
            document.execCommand("insertText", false, expectedText);
            
            await wait(100);
            if (inputElement.value === expectedText) {
              console.log("✓ execCommand fallback successful");
              resolve(true);
            } else {
              console.error("Text input failed even with fallback");
              resolve(false);
            }
          } catch (e) {
            console.error(`execCommand fallback failed: ${e.message}`);
            resolve(false);
          }
        } else {
          console.error("Text input verification failed for contenteditable");
          resolve(false);
        }
        return;
      }
      
      // Continue checking
      setTimeout(checkStatus, 100);
    };
    
    checkStatus();
  });
}

/**
 * Finds and clicks the submit button
 * @param {Element} inputElement - The input element (to help locate the form)
 * @throws {Error} If submit button cannot be found or clicked
 */
async function clickSubmitButton(inputElement) {
  console.log("Finding submit button...");
  
  try {
    // First try to find the button within the same form as the input element
    const form = inputElement.closest('form');
    
    // Helper function to check if button is truly interactive
    const isButtonReady = (button) => {
      if (!button) return false;
      
      // Check basic availability
      if (button.disabled || button.hasAttribute('disabled')) {
        console.log("Button found but disabled:", button);
        return false;
      }
      
      // Check visibility
      const style = window.getComputedStyle(button);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        console.log("Button found but not visible:", button);
        return false;
      }
      
      // Check if button is in viewport and has dimensions
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.log("Button found but has no dimensions:", button);
        return false;
      }
      
      console.log("Button ready:", {
        element: button,
        ariaLabel: button.getAttribute('aria-label'),
        type: button.type,
        text: button.textContent?.trim(),
        rect: rect
      });
      
      return true;
    };
    
    // Multiple strategies to find the submit button with enhanced logging
    // Note: Submit button may not exist until text is entered, so we wait for it
    console.log("Waiting for submit button to appear and become ready...");
    const submitButton = await waitUntil(() => {
      console.log("Polling for submit button...");
      
      // PRIMARY SELECTOR: button[aria-label="Submit"] - this is the most reliable
      const primarySubmitBtn = document.querySelector('button[aria-label="Submit"]');
      if (primarySubmitBtn && isButtonReady(primarySubmitBtn)) {
        console.log("✓ Found primary submit button via aria-label");
        return primarySubmitBtn;
      }
      
      // Within form - check for Submit button first
      if (form) {
        console.log("Checking within form for submit button...");
        
        // Look for submit buttons that are NOT search within the form
        const formButtons = Array.from(form.querySelectorAll('button[type="submit"]'));
        const nonSearchSubmit = formButtons.find(btn => {
          const ariaLabel = btn.getAttribute('aria-label');
          return ariaLabel !== 'Search' && isButtonReady(btn); // Exclude search button
        });
        if (nonSearchSubmit) {
          console.log("✓ Found form submit button (non-search)");
          return nonSearchSubmit;
        }
      }
      
      // Global backup selectors
      console.log("Checking global selectors...");
      
      // Look for submit buttons that are NOT search globally
      const allSubmitBtns = Array.from(document.querySelectorAll('button[type="submit"]'));
      const nonSearchSubmit = allSubmitBtns.find(btn => {
        const ariaLabel = btn.getAttribute('aria-label');
        return ariaLabel !== 'Search' && isButtonReady(btn);
      });
      if (nonSearchSubmit) {
        console.log("✓ Found global submit button (non-search)");
        return nonSearchSubmit;
      }
      
      // Last resort: look for send icon or submit text
      console.log("Trying fallback selectors (send icon/submit text)...");
      const fallbackButtons = Array.from(document.querySelectorAll('button'))
        .filter(btn => {
          if (!isButtonReady(btn)) return false;
          
          const hasSendIcon = btn.querySelector('svg path[d*="M2.01 21L23 12 2.01 3"]'); // Send icon
          const text = (btn.textContent || '').trim().toLowerCase();
          const hasSubmitText = text === 'submit' || text === 'send';
          return hasSendIcon || hasSubmitText;
        });
      
      if (fallbackButtons.length > 0) {
        console.log("✓ Found fallback submit button");
        return fallbackButtons[0];
      }
      
      console.log("No suitable submit button found in this polling cycle");
      return null;
    }, 8000, 200); // Increased timeout to 8 seconds and polling interval to 200ms for better reliability
    
    if (!submitButton) {
      console.error("Submit button search exhausted. Available buttons:", 
        Array.from(document.querySelectorAll('button')).map(btn => ({
          tag: btn.tagName,
          type: btn.type,
          ariaLabel: btn.getAttribute('aria-label'),
          text: btn.textContent?.trim(),
          disabled: btn.disabled,
          visible: window.getComputedStyle(btn).display !== 'none'
        }))
      );
      throw new Error("Submit button not found, not enabled, or not visible");
    }
    
    console.log("Submit button found and ready, clicking...");
    window.simulateButtonClick(submitButton);
    
    // Brief wait for submission to start
    await wait(100);
    
    // Success is presumed if we get this far
    console.log("✓ Submit button clicked successfully");
  } catch (error) {
    throw new Error(`Submit button interaction failed: ${error.message}`);
  }
}

// =============================================================================
//  EVENT SIMULATION - Helpers for simulating natural user interactions
// =============================================================================

/**
 * Simulates a complete button click with proper event sequence
 * @param {Element} element - The element to click
 */
window.simulateButtonClick = function(element) {
  // Use the full pointer/mouse event sequence for maximum compatibility
  const events = [
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, button: 0 }),
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }),
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window, button: 0 }),
    new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }),
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window, button: 0 })
  ];
  
  // Dispatch events with small delays to mimic natural interaction
  events.forEach(event => element.dispatchEvent(event));
}

/**
 * Simulates a complete focus sequence for text inputs
 * @param {Element} element - The element to focus
 */
window.simulateFocusSequence = function(element) {
  // The exact event sequence observed in natural browser interactions
  const events = [
    new FocusEvent("focus", { bubbles: true, view: window }),
    new FocusEvent("focusin", { bubbles: true, view: window }),
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window }),
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }),
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, view: window }),
    new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }),
    new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
  ];
  
  events.forEach(event => element.dispatchEvent(event));
  element.focus(); // Actual browser focus
}

// =============================================================================
//  UTILITY FUNCTIONS - General helpers used throughout the script
// =============================================================================

/**
 * Waits for a specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
window.llmBurstWait = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Waits until a condition is true or timeout expires
 * @param {Function} condition - Function that returns truthy when condition is met
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @param {number} interval - Polling interval in milliseconds
 * @returns {Promise<any>} - Resolves with condition result when true
 */
window.llmBurstWaitUntil = function(condition, timeout = 3000, interval = 100) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkCondition = () => {
      try {
        const result = condition();
        if (result) {
          resolve(result);
          return;
        }
      } catch (e) {
        // Ignore errors in condition function during polling
      }
      
      if (Date.now() - startTime > timeout) {
        reject(new Error("Timeout waiting for condition"));
        return;
      }
      
      setTimeout(checkCondition, interval);
    };
    
    checkCondition();
  });
}

"""

# --------------------------------------------------------------------------- #
#  FOLLOW-UP MESSAGE                                                          #
# --------------------------------------------------------------------------- #

FOLLOWUP_JS = r"""/**
 * Grok Follow-Up Message Script - Enhanced Reliability Edition
 * 
 * This script provides a robust method for submitting follow-up questions to Grok
 * after page navigation, with extensive error handling and verification steps
 * to ensure React properly processes the input and submission.
 */

// === Compatibility aliases (added by llm-burst) =============================
const wait      = (...args) => window.llmBurstWait(...args);
const waitUntil = (...args) => window.llmBurstWaitUntil(...args);
// =============================================================================

// Main function that Keyboard Maestro will call
window.grokFollowUpMessage = function(messageText, debug = false) {
  // Return a single promise for KM to handle
  return executeWithTimeout(
    performFollowUp(messageText, debug),
    20000, // 20-second maximum execution time
    "Timed out waiting for Grok UI to respond"
  ).then(result => {
    if (debug) console.log("Final result:", result);
    return result;
  });
}

/**
 * Executes the main logic with a timeout safety net
 */
window.executeWithTimeout = function(promise, timeoutMs, timeoutMessage) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  
  return Promise.race([promise, timeout])
    .catch(error => ({ 
      ok: false, 
      error: error.message || "Unknown error", 
      stepDurations: {}
    }));
}

/**
 * Main execution flow for follow-up question submission
 */
async function performFollowUp(messageText, debug) {
  const timing = {};
  const log = debug ? (...args) => console.log(...args) : () => {};
  
  try {
    log("Starting Grok follow-up submission...");
    
    // Step 1: Find the textarea using MutationObserver + polling fallback
    log("Finding textarea...");
    const textareaStartTime = performance.now();
    const textarea = await findTextareaWithObserver(log);
    timing.discovery = Math.round(performance.now() - textareaStartTime);
    log(`✓ Textarea found in ${timing.discovery}ms`);
    
    if (!textarea) {
      throw new Error("Unable to find Grok textarea");
    }
    
    // Step 2: Focus and input text with React-compatible events
    log(`Inputting text (${messageText.length} chars)...`);
    const inputStartTime = performance.now();
    await inputTextToTextarea(textarea, messageText, log);
    timing.input = Math.round(performance.now() - inputStartTime);
    log(`✓ Text input completed in ${timing.input}ms`);
    
    // Step 3: Verify text was accepted before proceeding
    log("Verifying text was accepted by React...");
    const verifyStartTime = performance.now();
    const verificationResult = await verifyTextAccepted(textarea, messageText, log);
    timing.verification = Math.round(performance.now() - verifyStartTime);
    
    if (!verificationResult.accepted) {
      log("⚠️ Primary input method failed, trying fallback...");
      await executeInputFallback(textarea, messageText, log);
      
      // Re-verify after fallback
      const fallbackVerification = await verifyTextAccepted(textarea, messageText, log);
      if (!fallbackVerification.accepted) {
        throw new Error("Text input not accepted by React after fallback attempt");
      }
      log("✓ Fallback input method succeeded");
    }
    
    // Step 4: Find and verify submit button is enabled
    log("Finding submit button...");
    const submitStartTime = performance.now();
    const submitButton = await findSubmitButton(textarea, log);
    
    if (!submitButton) {
      throw new Error("Submit button not found");
    }
    
    // Step 5: Click the submit button with full event sequence
    log("Clicking submit button...");
    await clickSubmitButtonFollowup(submitButton, log);
    timing.submit = Math.round(performance.now() - submitStartTime);
    
    // Step 6: Verify submission was successful
    const submissionVerified = await verifySubmissionStarted(log);
    timing.total = Math.round(performance.now() - textareaStartTime);
    
    log(`✅ Follow-up message successfully submitted in ${timing.total}ms`);
    return { 
      ok: true, 
      message: "Follow-up message submitted successfully", 
      stepDurations: timing 
    };
  } catch (error) {
    log(`❌ Error: ${error.message}`);
    return { 
      ok: false, 
      error: error.message, 
      stepDurations: timing 
    };
  }
}

/**
 * Finds the textarea using MutationObserver with polling fallback
 */
window.findTextareaWithObserver = function(log) {
  return new Promise((resolve) => {
    // First try immediate selection
    const immediateTextarea = window.findTextareaImmediately();
    if (immediateTextarea) {
      return resolve(immediateTextarea);
    }
    
    log("Textarea not immediately available, setting up observer...");
    
    // Set up MutationObserver to watch for textarea insertion
    const observer = new MutationObserver((mutations, obs) => {
      const textarea = window.findTextareaImmediately();
      if (textarea) {
        log("Textarea found via MutationObserver");
        obs.disconnect();
        resolve(textarea);
      }
    });
    
    // Observe the entire document for changes - specifically for textarea insertion
    observer.observe(document.body, { 
      childList: true, 
      subtree: true 
    });
    
    // Fallback: polling with timeout in case MutationObserver misses something
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds total
    
    const pollForTextarea = () => {
      attempts++;
      const textarea = window.findTextareaImmediately();
      
      if (textarea) {
        log(`Textarea found via polling (attempt ${attempts})`);
        observer.disconnect();
        resolve(textarea);
        return;
      }
      
      if (attempts >= maxAttempts) {
        log("Max polling attempts reached");
        observer.disconnect();
        resolve(null); // Resolve with null to handle gracefully
        return;
      }
      
      setTimeout(pollForTextarea, 100);
    };
    
    pollForTextarea();
  });
}

/**
 * Immediate textarea detection with multiple selector strategies
 */
window.findTextareaImmediately = function() {
  // Strategy 1: Direct aria-label match (most specific)
  let textarea = document.querySelector('textarea[aria-label="Ask Grok anything"]');
  
  // Strategy 2: Match on placeholder text containing "Grok"
  if (!textarea) {
    const textareas = Array.from(document.querySelectorAll('textarea'));
    textarea = textareas.find(el => {
      // Check for placeholder attribute
      if (el.placeholder && el.placeholder.toLowerCase().includes('grok')) {
        return true;
      }
      
      // Check for placeholder span near the textarea
      const parent = el.parentElement;
      if (parent) {
        const placeholderSpan = parent.querySelector('.pointer-events-none, span[aria-hidden="true"]');
        return placeholderSpan && placeholderSpan.textContent.toLowerCase().includes('grok');
      }
      
      return false;
    });
  }
  
  // Strategy 3: Any textarea within a form (least specific)
  if (!textarea) {
    textarea = document.querySelector('form textarea');
  }
  
  return textarea;
}

/**
 * Input text to textarea with React-compatible events
 */
async function inputTextToTextarea(textarea, text, log) {
  // Focus the textarea with natural event sequence
  window.simulateFocusSequence(textarea);
  await wait(50); // Brief pause after focus
  
  // Clear any existing content
  if (textarea.value) {
    textarea.select();
    document.execCommand('delete');
    await wait(50);
  }
  
  // Set value and dispatch proper events for React
  textarea.value = text;
  
  // Critical: Use InputEvent with proper inputType and data for React
  textarea.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPaste',
    data: text
  }));
  
  // Set selection range to end of text
  textarea.selectionStart = textarea.selectionEnd = text.length;
  
  // Dispatch standard change event
  textarea.dispatchEvent(new Event('change', {
    bubbles: true,
    cancelable: true
  }));
  
  // Add some key events to simulate user interaction
  simulateTypingActivity(textarea);
  
  return wait(100); // Brief pause to let React process
}

/**
 * Simulate focus sequence for text inputs
 */
function simulateFocusSequence(element) {
  // Match browser's exact event sequence
  const events = [
    new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    new MouseEvent('mouseup', { bubbles: true, cancelable: true }),
    new MouseEvent('click', { bubbles: true, cancelable: true }),
    new FocusEvent('focus', { bubbles: true }),
    new FocusEvent('focusin', { bubbles: true })
  ];
  
  events.forEach(event => element.dispatchEvent(event));
  element.focus(); // Actual browser focus
}

/**
 * Simulate some keyboard activity to ensure React notices the input
 */
window.simulateTypingActivity = function(element) {
  // Simulate a keystroke after paste
  element.dispatchEvent(new KeyboardEvent('keydown', { 
    key: 'Process', 
    bubbles: true 
  }));
  
  element.dispatchEvent(new KeyboardEvent('keyup', { 
    key: 'Process', 
    bubbles: true 
  }));
}

/**
 * Verify text was accepted by React
 */
async function verifyTextAccepted(textarea, expectedText, log) {
  return new Promise(resolve => {
    let attempts = 0;
    const maxAttempts = 10;
    
    const checkAccepted = () => {
      // Check 1: Value matches expected
      const valueCorrect = textarea.value === expectedText;
      
      // Check 2: Placeholder hidden (critical for React state)
      const parent = textarea.parentElement;
      let placeholderHidden = true;
      
      if (parent) {
        const placeholder = parent.querySelector('.pointer-events-none, span[aria-hidden="true"]');
        if (placeholder) {
          placeholderHidden = 
            window.getComputedStyle(placeholder).display === 'none' || 
            placeholder.style.display === 'none' || 
            placeholder.classList.contains('hidden') ||
            placeholder.getAttribute('aria-hidden') === 'true';
        }
      }
      
      // Check 3: Submit button enabled
      const form = textarea.closest('form');
      const submitButton = form ? 
        form.querySelector('button[type="submit"]') : 
        document.querySelector('button[type="submit"]');
      
      const submitEnabled = submitButton && !submitButton.disabled;
      
      if (valueCorrect && placeholderHidden && submitEnabled) {
        log("✓ Text input verified accepted by React");
        resolve({ accepted: true });
        return;
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        log(`⚠️ Text verification failed after ${maxAttempts} attempts:`);
        log(`  - Value correct: ${valueCorrect}`);
        log(`  - Placeholder hidden: ${placeholderHidden}`);
        log(`  - Submit enabled: ${submitEnabled}`);
        resolve({ 
          accepted: false,
          valueCorrect,
          placeholderHidden,
          submitEnabled
        });
        return;
      }
      
      setTimeout(checkAccepted, 100);
    };
    
    checkAccepted();
  });
}

/**
 * Execute fallback input method if primary method fails
 */
async function executeInputFallback(textarea, text, log) {
  log("Executing input fallback method...");
  
  // Re-focus the textarea
  textarea.focus();
  await wait(50);
  
  // Clear existing content
  textarea.value = '';
  
  // Try execCommand approach
  try {
    const execCommandSupported = document.queryCommandSupported('insertText');
    if (execCommandSupported) {
      document.execCommand('insertText', false, text);
      log("Used execCommand insertText fallback");
    } else {
      // Last resort: direct assignment + multiple events
      textarea.value = text;
      log("Used direct value assignment fallback");
    }
  } catch (e) {
    log(`execCommand fallback error: ${e.message}`);
    // Direct assignment as final fallback
    textarea.value = text;
  }
  
  // Dispatch multiple input events with different configurations
  [
    new InputEvent('input', { bubbles: true, cancelable: true }),
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }),
    new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: text }),
    new Event('input', { bubbles: true, cancelable: true }),
    new Event('change', { bubbles: true, cancelable: true })
  ].forEach(event => textarea.dispatchEvent(event));
  
  // Simulate keystrokes to activate listeners
  'abcdefghij'.split('').forEach(char => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
  });
  
  return wait(200); // Give React more time to notice
}

/**
 * Find submit button with reliable detection strategies
 */
async function findSubmitButton(textarea, log) {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds
    
    const checkForButton = () => {
      // Strategy 1: Find button within same form as textarea
      const form = textarea.closest('form');
      let submitButton = null;
      
      if (form) {
        submitButton = form.querySelector('button[type="submit"]:not([disabled])') ||
                      form.querySelector('button[aria-label="Submit"]:not([disabled])');
      }
      
      // Strategy 2: Global submit button search
      if (!submitButton) {
        submitButton = document.querySelector('button[type="submit"]:not([disabled])') ||
                      document.querySelector('button[aria-label="Submit"]:not([disabled])');
      }
      
      // Strategy 3: Look for icon buttons with send icon
      if (!submitButton) {
        const buttons = Array.from(document.querySelectorAll('button:not([disabled])'));
        submitButton = buttons.find(btn => {
          const hasSendIcon = btn.querySelector('svg path[d*="M2,21L23"]'); // Common path for send icon
          const ariaLabel = btn.getAttribute('aria-label');
          return hasSendIcon || (ariaLabel && ariaLabel.toLowerCase().includes('send'));
        });
      }
      
      if (submitButton && !submitButton.disabled) {
        log(`✓ Submit button found (attempt ${attempts + 1})`);
        resolve(submitButton);
        return;
      }
      
      attempts++;
      if (attempts >= maxAttempts) {
        log(`⚠️ Submit button not found or not enabled after ${maxAttempts} attempts`);
        resolve(null);
        return;
      }
      
      setTimeout(checkForButton, 100);
    };
    
    checkForButton();
  });
}

/**
 * Click submit button with complete event sequence (follow-up mode)
 */
async function clickSubmitButtonFollowup(button, log) {
  log("Clicking submit button with full event sequence...");
  
  // Complete pointer/mouse sequence that browsers generate
  const events = [
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
    new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0 }),
    new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }),
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
  ];
  
  // Dispatch events with small delays to mimic natural interaction
  for (const event of events) {
    button.dispatchEvent(event);
    await wait(10); // Brief delay between events
  }
  
  // Verify button state changed if it has aria-pressed
  if (button.hasAttribute('aria-pressed')) {
    await waitForCondition(
      () => button.getAttribute('aria-pressed') === 'true',
      1000,
      50
    ).catch(() => log("⚠️ Button press state change not confirmed"));
  }
  
  log("✓ Submit button clicked");
  return wait(100); // Brief pause after click
}

/**
 * Verify submission started by looking for response indicators
 */
async function verifySubmissionStarted(log) {
  log("Verifying submission was processed...");
  
  return new Promise((resolve) => {
    // Set up observer to look for typing indicators or response elements
    const observer = new MutationObserver((mutations, obs) => {
      // Look for new message container or typing indicator
      const responseStarted = 
        document.querySelector('.typing-indicator') || 
        document.querySelector('.message-item:last-child') ||
        document.querySelector('[data-testid="assistant-message"]');
      
      if (responseStarted) {
        log("✓ Response started appearing in DOM");
        obs.disconnect();
        resolve(true);
      }
    });
    
    // Watch for new elements in the chat container
    const chatContainer = document.querySelector('.chat-container') || 
                          document.querySelector('.messages-container') ||
                          document.body; // Fallback to body if containers not found
    
    observer.observe(chatContainer, { 
      childList: true, 
      subtree: true, 
      attributes: true 
    });
    
    // Set timeout to avoid hanging
    setTimeout(() => {
      observer.disconnect();
      log("⚠️ Could not confirm response started, but proceeding");
      resolve(false);
    }, 2000);
  });
}

/**
 * Helper: Wait for a specified time
 */
window.llmBurstWait = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper: Wait until condition is true or timeout
 */
window.waitForCondition = function(condition, timeout = 3000, interval = 100) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkCondition = () => {
      try {
        const result = condition();
        if (result) {
          resolve(result);
          return;
        }
      } catch (e) {
        // Ignore errors during polling
      }
      
      if (Date.now() - startTime > timeout) {
        reject(new Error("Condition timeout"));
        return;
      }
      
      setTimeout(checkCondition, interval);
    };
    
    checkCondition();
  });
}

"""

# --------------------------------------------------------------------------- #
#  QUICK SELECTOR SMOKE-TEST                                                  #
# --------------------------------------------------------------------------- #


def selectors_up_to_date(page) -> bool:
    """Quick Playwright test that Grok's key selectors still resolve.

    The check is deliberately *very* light-weight so that it can be used in a
    CI environment with mocked HTML (see tests/).
    """
    try:
        return page.evaluate(
            """
            () => {
                const inputElement = document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
                                    document.querySelector('form textarea') ||
                                    document.querySelector('[contenteditable="true"]');
                const sendBtn  = document.querySelector('button[type="submit"]') ||
                                 document.querySelector('button[aria-label="Submit"]');
                return inputElement !== null && sendBtn !== null;
            }
            """
        )
    except Exception:
        return False
