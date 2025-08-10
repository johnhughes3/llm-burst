# llm-burst Implementation Review and Remediation Plan

This document assesses the current implementation against the original Keyboard Maestro (KM) macros, adjusted by specs in `docs/specs.md`, and outlines a concrete, prioritized plan to address gaps and risks.

## Coverage vs. Specs

- Activate (⌃⌥R) → `llm-burst activate`
  - Status: Implemented end-to-end using Playwright and Chrome CDP. Opens provider windows, injects JS, and can auto‑name. Uses CDP-only for optional arrangement when not in research mode.
  - Notes: Auto‑naming currently renames internal per‑tab identifiers, which breaks follow‑up and grouping (see G1).

- Follow‑up (⌃⌥F) → `llm-burst follow-up`
  - Status: Implemented. Sends a follow‑up to each provider tab in a session.
  - Notes: Depends on name-based lookups; breaks after auto‑naming that changes per‑tab names (see G1).

- Arrange (⌃⌥W) → `llm-burst arrange`
  - Status: Implemented via CDP window bounds (`layout_manual.py`). No external window manager required.
  - Notes: Prefer CDP for portability; no macOS permissions needed.

- Group/UnGroup (⌃⌥G) → `llm-burst toggle-group`
  - Status: Partial. Grouping is implemented via a tab-groups API; ungroup behavior is not implemented (placeholder `_ungroup_` name is passed but not handled).
  - Notes: Requires proper Ungroup implementation and name-independent routing (see G2, G1).

- Chrome bootstrap (ensure remote debugging)
  - Status: Implemented (idempotent), with dialog/console prompt.
  - Notes: Helper scripts referenced but not present in repo (see G5).

- swiftDialog prompt
  - Status: `prompt_user()` calls the `dialog` CLI directly with clipboard fallback; console fallbacks exist.
  - Notes: Suppresses benign macOS LSOpen (-50) warnings.

- Sites JavaScript (providers)
  - Status: Injector scaffolding present; assumes `llm_burst.sites.*` modules provide `SUBMIT_JS`/`FOLLOWUP_JS` with defined entrypoints.
  - Notes: Verify presence and alignment of entrypoints; not included in this snapshot (see G6).

- Auto‑naming (Stage‑4)
  - Status: Implemented via Gemini API; extracts conversation and proposes names.
  - Notes: Tightly coupled to per‑tab LiveSession renames, causing downstream issues (see G1). Selector robustness can be improved (see R4).

## Key Gaps and Risks

G1. Name-coupling breaks follow-up and grouping after auto‑naming
- Symptom: `follow-up` and `toggle-group` reconstruct per‑tab names using `_task_slug(session_title, provider)`. During `activate`, auto‑namer renames per‑tab `LiveSession.task_name` to a human-friendly title, so later name-based lookups fail.
- Impact: Follow‑up and grouping may report “No live session found” or silently skip tabs.
- Root cause: Internal identifier (per‑tab `task_name`) doubles as user-facing label. Auto‑naming mutates it.

G2. Ungroup not implemented
- Symptom: `toggle-group` uses a sentinel `"_ungroup_"` to request ungrouping, but `BrowserAdapter.move_task_to_group()` only adds tabs to groups; no removal path exists.
- Impact: Users cannot ungroup previously grouped sessions; state may drift.

G3. ChatGPT URL outdated
- Observation: `LLM_URLS[CHATGPT]` points to `https://chat.openai.com` while macros/specs use `https://chatgpt.com/?model=o3-pro`.
- Impact: Selector drift and model targeting differences; may affect JS injector reliability.

G4. Tab-groups CDP session usage
- Observation: `tab_groups._async_create_group()` uses a private Playwright attribute (`_connection`) instead of the adapter’s CDP session helper.
- Impact: Fragile/private API usage; may break across Playwright versions.

G5. Missing helper scripts in `bin/`
- Observation: Code references `bin/swift_prompt.sh` and `bin/swift_chrome_fix.sh`, but these are not present in this snapshot.
- Impact: `prompt_user()` and Chrome relaunch dialog will fail or fall back; user experience degraded.

G6. Provider JS contract visibility
- Observation: `providers/__init__.py` templates expect entrypoints such as `automateOpenAIChat`, `automateGeminiChat`, etc. The `llm_burst.sites.*` modules are not included here to confirm API.
- Impact: Potential runtime failures if names mismatch or scripts missing.

G7. Gemini client configuration assumptions
- Observation: Uses `response_schema=TaskName.model_json_schema()` and expects `response.text` to be strict JSON. Library behavior varies by version.
- Impact: Occasional JSON parse errors; brittle across google‑generativeai versions.

G8. Conversation selectors fragility
- Observation: Static selectors for message extraction may drift across providers.
- Impact: Auto‑namer may often find no content and silently skip.

G9. AIOHTTP dependency and local-CDP polling
- Observation: `_get_websocket_endpoint()` uses `aiohttp`; ensure it’s declared and available. Some environments restrict loopback HTTP.
- Impact: Connection probing might fail due to missing deps or network policy.

## Remediation Plan (Prioritized)

P1. Decouple internal IDs from display names (fixes G1)
- Keep `LiveSession.task_name` as a stable internal identifier (slug) and never rename it during multi-provider activation.
- Add a “display-only” rename path: during `activate`, compute a suggested session title and:
  - Set the browser tab title via `set_window_title()` for each tab.
  - Rename only the `MultiProviderSession.title` (session-level), not per-tab names.
- Update `auto_namer`:
  - Extract a pure "suggestion" function (e.g., `suggest_task_name(page, provider) -> Optional[str]`) that doesn’t mutate state.
  - Keep `auto_name_session()` only for single-provider `open`, where per-tab renaming is safe.
- Update `follow-up` and `toggle-group` to avoid name-based routing:
  - Use `StateManager.get_session(session_title)` → iterate `tabs` → route by `tab_id` (CDP targetId) via `BrowserAdapter._find_page_for_target()`.
  - Provide a new helper `send_prompt_by_target(target_id, provider, prompt, follow_up=True)` to avoid name lookups altogether.
- Acceptance: After auto‑naming in `activate`, `follow-up` and `toggle-group` succeed without depending on renamed per‑tab names.

P2. Implement Ungroup (fixes G2)
- Extend `BrowserAdapter` with an `ungroup_task(task_name)` or general `remove_target_from_group(target_id)` method using the Tab Groups CDP domain. If ungroup API is not available, emulate by moving to an implicit "no group" state (e.g., groupId = -1) or recreate the window if necessary.
- Update `toggle-group` ungroup branch to call the new removal method instead of the `_ungroup_` sentinel.
- Persist updated `group_id` in state.
- Acceptance: `toggle-group` makes group → ungroup → group round‑trips without losing tabs and `state.json` reflects correct group state.

P3. Update ChatGPT landing URL (fixes G3)
- Change to `https://chatgpt.com/?model=o3-pro` (or a configurable default).
- Verify injector selectors against updated UI.
- Acceptance: ChatGPT tab opens on the expected model page and injector works reliably.

P4. Harden tab-groups CDP usage (fixes G4)
- Replace `adapter._browser.contexts[0]._connection` with `await adapter._get_cdp_connection()` in `tab_groups._async_create_group()`.
- Acceptance: Tab-group creation works across Playwright versions without private attribute access.

P5. Provide `bin/` helper scripts or degrade gracefully (fixes G5)
- Add minimal `bin/swift_prompt.sh` and `bin/swift_chrome_fix.sh` with graceful detection and fallbacks, or gate their use behind existence checks.
- Acceptance: `prompt_user()` works when scripts are present; otherwise clean fallback path without abrupt exits.

P6. Provider JS contract validation (fixes G6)
- Ensure `llm_burst.sites.{chatgpt,gemini,claude,grok}` exist with `SUBMIT_JS`/`FOLLOWUP_JS` that define entrypoints expected by `providers.get_injector()`.
- Add a fast self-test (e.g., import and assert callable names exist in JS strings) and a smoke Playwright test that evaluates each entrypoint without performing network calls.
- Acceptance: Import- and injection-time checks prevent mysterious runtime failures.

P7. Gemini client robustness (fixes G7)
- Accept either `response_schema` output or free-form `response.text` by:
  - Allowing for `response.candidates[0].content.parts[0].text` if present.
  - Stripping code fences and trying a second parse if first JSON parse fails.
  - Feature-detecting library version to set `response_schema` appropriately.
- Acceptance: Name suggestion succeeds or logs a clear warning with graceful fallback.

P8. Conversation extraction resilience (fixes G8)
- Add multiple selector strategies per provider and a final fallback to recent visible text in the main chat container (limited length).
- Keep a provider-specific extraction helper that can be unit-tested with static HTML fixtures.
- Acceptance: Auto‑namer produces suggestions across minor UI changes.

P9. Dependencies and environment (fixes G9)
- Ensure `aiohttp` is in `requirements.txt` or replace with `urllib.request` for the local JSON fetch.
- Add a quick `chrome-status` preflight in error paths to guide users if loopback is blocked.
- Acceptance: Connection probing is reliable or provides actionable diagnostics.

## Additional Refinements

R1. Clarify `open --reuse` semantics
- Current help text says: “Fail if task-name already exists instead of re-creating.” Confirm desired behavior and adjust logic or help text for clarity (e.g., `--no-reuse` vs `--reuse`).

R2. Make providers configurable
- Allow landing URLs and injector model choices (e.g., o3-pro) to be overridden via env or CLI flags.

R3. State schema notes
- Current v2.1 schema diverges slightly from the spec example (missing `browser` field). Document current shape in README and ensure upgrade path remains backward-compatible.

R4. Clipboard fallbacks
- Where `pyperclip` fails, prefer JS-based text insertion paths to reduce reliance on OS clipboard in automation flows.

R5. Tests
- Add/restore tests outlined in `docs/specs.md`, at least as smoke tests for this repo: activation selector presence, follow-up routing by targetId, group/ungroup state round-trips, and auto-namer suggestion path.

R6. CDP arrangement robustness
- Ensure macOS NSScreen geometry conversion to top-left origin is correct.
- Add small inter-move delays to reduce race conditions on slower machines.
- Mock CDP in tests to avoid platform dependencies.

## Proposed Implementation Sequence

1) P1 (ID/display decoupling + follow-up by targetId)
2) P2 (Ungroup) + P4 (CDP session hardening)
3) P3 (ChatGPT URL) + P6 (provider JS contract check)
4) P5 (bin scripts/fallbacks) + P9 (deps)
5) P7 (Gemini robustness) + P8 (selector resilience)
6) R1–R6 refinements and tests

## Acceptance Criteria Summary

- Auto-naming no longer breaks follow-up or grouping.
- Grouping and ungrouping both work and persist correctly.
- ChatGPT tab opens on the intended URL and injection succeeds.
- Tab-group operations use stable CDP sessions; no private attrs.
- CLI works with or without optional scripts, with clear fallbacks.
- Provider JS entrypoints match injector calls; quick smoke tests pass.
- Auto‑namer suggestions are resilient and parse reliably.
