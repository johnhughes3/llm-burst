"""Grok site automation JavaScript selectors and functions.

This file was generated automatically from the Grok blocks stored in the
Keyboard-Maestro macros (LLMs Activate / LLMs Follow Up).  The JavaScript is
kept verbatim so that it can be injected into the browser without further
transformation.
"""

# --------------------------------------------------------------------------- #
#  INITIAL SUBMIT (first prompt)                                              #
# --------------------------------------------------------------------------- #

SUBMIT_JS = r"""
// Grok Automation Script - Ultimate Version v1.0
// ---------------------------------------------------------------------------
//  This code was extracted from the "LLMs Activate" Keyboard-Maestro macro.
//  It drives Grok in the browser:  optional Incognito & Research modes,
//  robust textarea / button detection, event-simulation helpers …
//
//  NB:  The code is intentionally left exactly as used in production so that
//  future selector changes can be diffed easily.
// ---------------------------------------------------------------------------

async function automateGrokChat(promptText, researchMode, incognitoMode) {
  console.log(`Starting Grok automation: Research=${researchMode}, Incognito=${incognitoMode}`);

  try {
    // Step-1 : configure modes before typing
    await configureChatModes(researchMode, incognitoMode);

    // Step-2 : send the text
    await sendPromptToGrok(promptText);

    console.log("✅ Grok automation completed successfully");
  } catch (error) {
    console.error(`❌ Grok automation failed: ${error.message}`);
  }
}

/* =======================  MODE CONFIGURATION  =========================== */

async function configureChatModes(research, incognito) {
  if (incognito === "Yes") {
    await enableIncognitoMode().catch(() => {});
    await wait(300);
  }

  if (research === "Yes") {
    try { await enableDeeperSearch(); }
    catch { await enableThinkMode(); }
  } else {
    await enableThinkMode();
  }

  await wait(300);
}

async function enableIncognitoMode() {
  const btn = await waitUntil(() =>
    document.querySelector('[aria-label="Switch to Private Chat"]') ||
    document.querySelector('button[title*="Private Chat" i]')
  , 2000, 100);

  if (!btn) throw new Error("Private-chat button not found");
  simulateButtonClick(btn);
  await wait(200);
}

async function enableDeeperSearch() {
  const dropdown = await findModeDropdown();
  const opened = dropdown.getAttribute("aria-expanded") === "true";
  if (!opened) { dropdown.click(); await wait(300); }

  const option = await findDeeperSearchOption();
  if (!option) throw new Error("DeeperSearch option not found");
  if (option.getAttribute("aria-checked") !== "true") {
      simulateButtonClick(option);
      await wait(300);
  }

  if (!opened) dropdown.click();
}

async function enableThinkMode() {
  const btn = await waitUntil(() =>
    document.querySelector('button[aria-label="Think"]') ||
    document.querySelector('button[data-testid="think-button"]')
  , 2000, 100);

  if (btn && btn.getAttribute("aria-pressed") !== "true") {
    simulateButtonClick(btn);
    await wait(200);
  }
}

/* =======================  PROMPT SUBMISSION  ============================ */

async function sendPromptToGrok(messageText) {
  const textarea = await findAndPrepareTextarea();
  await executeTextInput(textarea, messageText);
  await clickSubmitButton(await findSubmitButton(textarea));
}

async function findAndPrepareTextarea() {
  const textarea = await waitUntil(() =>
    document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
    document.querySelector('form textarea')
  , 3000, 100);

  if (!textarea) throw new Error("Textarea not found");
  simulateFocusSequence(textarea);
  await wait(50);
  return textarea;
}

async function executeTextInput(textarea, text) {
  textarea.value = text;
  textarea.dispatchEvent(new InputEvent("input", {
    bubbles: true, cancelable: true, inputType: "insertFromPaste", data: text
  }));
  textarea.selectionStart = textarea.selectionEnd = text.length;
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(100);
}

async function findSubmitButton(textarea) {
  return await waitUntil(() => {
    const form = textarea.closest("form");
    return (form && form.querySelector('button[type="submit"]')) ||
           document.querySelector('button[type="submit"]');
  }, 3000, 100);
}

async function clickSubmitButton(btn) {
  simulateButtonClick(btn);
  await wait(100);
}

/* =======================  UTILS ========================================= */

function simulateButtonClick(el) {
  ["pointerdown","mousedown","pointerup","mouseup","click"].forEach(type =>
    el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, button:0 }))
  );
}

function simulateFocusSequence(el) {
  ["mousedown","mouseup","click","focus","focusin"].forEach(type =>
    el.dispatchEvent(new Event(type, { bubbles:true, cancelable:true }))
  );
  el.focus();
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
function waitUntil(cond, timeout=3000, int=100) {
  return new Promise((res, rej) => {
    const start = Date.now();
    (function poll(){
      try { if (cond()) return res(cond()); }
      catch(_) {}
      if (Date.now()-start > timeout) return rej();
      setTimeout(poll, int);
    })();
  });
}

async function findModeDropdown() {
  return await waitUntil(() =>
    document.querySelector('button[aria-label="Change mode"]') ||
    document.querySelector('button[aria-haspopup="menu"]')
  , 2000, 100);
}

async function findDeeperSearchOption() {
  return await waitUntil(() => {
    const items = document.querySelectorAll('[role="menuitemcheckbox"],[role="option"]');
    return Array.from(items).find(i => /Deeper\s?Search/i.test(i.textContent||""));
  }, 2000, 100);
}

/* =======================  ENTRY-POINT  ================================ */
//  KM sets kmvar.PromptText / Research / Incognito; call with defaults
if (typeof kmvar !== "undefined") {
  automateGrokChat(kmvar.PromptText || "", kmvar.Research || "No", kmvar.Incognito || "No");
}
"""

# --------------------------------------------------------------------------- #
#  FOLLOW-UP MESSAGE                                                          #
# --------------------------------------------------------------------------- #

FOLLOWUP_JS = r"""
/**
 * Grok Follow-Up Message Script  (extracted from "LLMs Follow Up" macro)
 * Sends an additional prompt in an already-open Grok conversation.
 */
function grokFollowUpMessage(messageText) {
  return new Promise((resolve, reject) => {
    try {
      const textarea =
        document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
        document.querySelector('form textarea');
      if (!textarea) { reject("Textarea not found"); return; }

      textarea.focus();
      textarea.value = messageText;
      textarea.dispatchEvent(new InputEvent("input", {
        bubbles:true, cancelable:true, inputType:"insertFromPaste", data:messageText
      }));

      setTimeout(() => {
        const submit =
          (textarea.closest("form")||document).querySelector('button[type="submit"]');
        if (!submit) { reject("Submit button not found"); return; }
        if (submit.disabled) { reject("Submit button disabled"); return; }
        submit.click();
        resolve();
      }, 300);
    } catch (e) { reject(e.toString()); }
  });
}

// When injected via KM the variable will exist:
if (typeof kmvar !== "undefined") { grokFollowUpMessage(kmvar.PromptText || ""); }
"""

# --------------------------------------------------------------------------- #
#  QUICK SELECTOR SMOKE-TEST                                                  #
# --------------------------------------------------------------------------- #

def selectors_up_to_date(page) -> bool:
    """Quick Playwright test that Grok’s key selectors still resolve.

    The check is deliberately *very* light-weight so that it can be used in a
    CI environment with mocked HTML (see tests/).
    """
    try:
        return page.evaluate(
            """
            () => {
                const textarea = document.querySelector('textarea[aria-label="Ask Grok anything"]') ||
                                 document.querySelector('form textarea');
                const sendBtn  = document.querySelector('button[type="submit"]') ||
                                 document.querySelector('button[aria-label="Submit"]');
                return textarea !== null && sendBtn !== null;
            }
            """
        )
    except Exception:
        return False