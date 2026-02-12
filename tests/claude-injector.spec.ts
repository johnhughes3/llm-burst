import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createClaudeFixture, type ClaudeFixtureOptions } from './fixtures/claudePage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const utilsPath = resolve(projectRoot, 'chrome_ext/content/injectors/utils.js');
const claudePath = resolve(projectRoot, 'chrome_ext/content/injectors/claude.js');

declare global {
  interface Window {
    llmBurst: {
      injectors: Record<string, any>;
    };
    __sendClicks: number;
    __lastComposerHtml: string;
    __researchEnabled: boolean;
    __incognitoActive: boolean;
    __incognitoClicks: number;
    __editorRemounted: boolean;
    __activeEditorId: string;
  }
}

async function loadClaudeInjector(page: Page, options: ClaudeFixtureOptions = {}) {
  const html = createClaudeFixture(options);
  await page.setContent(html);
  await page.addScriptTag({ path: utilsPath });
  await page.addScriptTag({ path: claudePath });
  await page.waitForFunction(() => {
    return Boolean(window.llmBurst?.injectors?.CLAUDE);
  });
}

test.describe('Claude injector', () => {
  test('submits prompt and clicks send with default composer', async ({ page }) => {
    await loadClaudeInjector(page);

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Hello Claude', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml).toContain('Hello Claude');
  });

  test('submits prompt with plaintext-only editor', async ({ page }) => {
    await loadClaudeInjector(page, { contentEditableMode: 'plaintext-only' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Plaintext Claude', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml.toLowerCase()).toContain('plaintext claude');
  });

  test('enables research mode via tools menu', async ({ page }) => {
    await loadClaudeInjector(page, { researchState: 'open-disabled' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Research please', options: { research: true } });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const researchEnabled = await page.evaluate(() => window.__researchEnabled);
    expect(researchEnabled).toBe(true);
  });

  test('enables incognito mode and handles editor remount', async ({ page }) => {
    await loadClaudeInjector(page, {
      includeHiddenEditor: true,
      incognitoButton: true,
      incognitoRemountsEditor: true,
    });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Incognito message',
        options: { incognito: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const incognitoState = await page.evaluate(() => ({
      active: window.__incognitoActive,
      dataset: document.body.dataset.incognito,
      clicks: window.__incognitoClicks,
    }));
    expect(incognitoState.active).toBe(true);
    expect(incognitoState.dataset).toBe('active');
    expect(incognitoState.clicks).toBeGreaterThanOrEqual(1);

    const remounted = await page.evaluate(() => window.__editorRemounted);
    expect(remounted).toBe(true);

    const activeEditorId = await page.evaluate(() => window.__activeEditorId);
    expect(activeEditorId).toBe('composer-2');
  });

  test('records warning when incognito toggle missing', async ({ page }) => {
    await loadClaudeInjector(page);

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Proceed anyway',
        options: { incognito: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      'Incognito button not found (attempt 1)',
      'Incognito button not found (attempt 2)',
      'Incognito activation could not be confirmed',
      'Incognito mode could not be confirmed; continuing without it',
    ]);
  });

  test('follow-up reuses compose pipeline', async ({ page }) => {
    await loadClaudeInjector(page, { incognitoButton: true });

    await page.evaluate(async () => {
      await window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Initial', options: {} });
    });

    const follow = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.followup({ prompt: 'Follow response' });
    });

    expect(follow.ok).toBe(true);
    expect(follow.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(2);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml).toContain('Follow response');
  });
});

test.describe('Claude injector (lexical variant)', () => {
  test('submits prompt and sends via split-button composer', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'lexical' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Hello Lexical', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml.toLowerCase()).toContain('hello lexical');
  });

  test('enables research toggle inside portal menu', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'lexical', researchState: 'closed' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Research via portal',
        options: { research: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const researchEnabled = await page.evaluate(() => window.__researchEnabled);
    expect(researchEnabled).toBe(true);
  });

  test('enables incognito and recovers after editor remount', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'lexical', incognitoRemountsEditor: true });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Lexical incognito',
        options: { incognito: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const incognitoState = await page.evaluate(() => ({
      active: window.__incognitoActive,
      dataset: document.body.dataset.incognito,
      clicks: window.__incognitoClicks,
    }));

    expect(incognitoState.active).toBe(true);
    expect(incognitoState.dataset).toBe('active');
    expect(incognitoState.clicks).toBeGreaterThanOrEqual(1);

    const remounted = await page.evaluate(() => window.__editorRemounted);
    expect(remounted).toBe(true);

    const activeEditorId = await page.evaluate(() => window.__activeEditorId);
    expect(activeEditorId).toContain('composer-lex-');
  });

  test('follow-up uses active lexical editor', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'lexical' });

    await page.evaluate(async () => {
      await window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Lexical start', options: {} });
    });

    const follow = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.followup({ prompt: 'Lexical follow-up' });
    });

    expect(follow.ok).toBe(true);
    expect(follow.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(2);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml.toLowerCase()).toContain('lexical follow-up');
  });
});

test.describe('Claude injector (Sonnet 4.5 variant)', () => {
  test('submits prompt and sends via artifacts composer', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'sonnet45' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Hello Sonnet', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml.toLowerCase()).toContain('hello sonnet');
  });

  test('enables research via model pill shortcut', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'sonnet45', researchState: 'closed' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Enable research pill',
        options: { research: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const researchEnabled = await page.evaluate(() => window.__researchEnabled);
    expect(researchEnabled).toBe(true);
  });

  test('enables incognito toggle and survives editor remount', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'sonnet45', incognitoRemountsEditor: true });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.submit({
        prompt: 'Sonnet incognito',
        options: { incognito: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const incognitoState = await page.evaluate(() => ({
      active: window.__incognitoActive,
      dataset: document.body.dataset.incognito,
      clicks: window.__incognitoClicks,
    }));

    expect(incognitoState.active).toBe(true);
    expect(incognitoState.dataset).toBe('active');
    expect(incognitoState.clicks).toBeGreaterThanOrEqual(1);

    const remounted = await page.evaluate(() => window.__editorRemounted);
    expect(remounted).toBe(true);

    const activeEditorId = await page.evaluate(() => window.__activeEditorId);
    expect(activeEditorId).toMatch(/composer-sonnet-/);
  });

  test('follow-up reuses sonnet composer pipeline', async ({ page }) => {
    await loadClaudeInjector(page, { variant: 'sonnet45' });

    await page.evaluate(async () => {
      await window.llmBurst.injectors.CLAUDE.submit({ prompt: 'Initial Sonnet', options: {} });
    });

    const follow = await page.evaluate(async () => {
      return window.llmBurst.injectors.CLAUDE.followup({ prompt: 'Sonnet follow-up' });
    });

    expect(follow.ok).toBe(true);
    expect(follow.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(2);

    const lastHtml = await page.evaluate(() => window.__lastComposerHtml);
    expect(lastHtml.toLowerCase()).toContain('sonnet follow-up');
  });
});
