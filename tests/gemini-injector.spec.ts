import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createGeminiFixture, type GeminiFixtureOptions } from './fixtures/geminiPage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const utilsPath = resolve(projectRoot, 'chrome_ext/content/injectors/utils.js');
const geminiPath = resolve(projectRoot, 'chrome_ext/content/injectors/gemini.js');

declare global {
  interface Window {
    llmBurst: {
      injectors: Record<string, any>;
    };
    __sendClicks: number;
    __lastComposerText: string;
  }
}

async function loadGeminiInjector(page: Page, options: GeminiFixtureOptions = {}) {
  const html = createGeminiFixture(options);
  await page.setContent(html);
  await page.addScriptTag({ path: utilsPath });
  await page.addScriptTag({ path: geminiPath });
  await page.waitForFunction(() => {
    return Boolean(window.llmBurst?.injectors?.GEMINI);
  });
}

test.describe('Gemini injector', () => {
  test('submits prompt with legacy editor', async ({ page }) => {
    await loadGeminiInjector(page, { variant: 'legacy' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.GEMINI.submit({ prompt: 'Hello Gemini', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastText = await page.evaluate(() => window.__lastComposerText);
    expect(lastText).toContain('Hello Gemini');
  });

  test('submits prompt with plaintext-only editor', async ({ page }) => {
    await loadGeminiInjector(page, { variant: 'modern', includeHiddenLegacyEditor: true });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.GEMINI.submit({ prompt: 'Plaintext Gemini', options: {} });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastText = await page.evaluate(() => window.__lastComposerText);
    expect(lastText.toLowerCase()).toContain('plaintext gemini');
  });

  test('follow-up uses textarea editor', async ({ page }) => {
    await loadGeminiInjector(page, { variant: 'textarea' });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.GEMINI.followup({ prompt: 'Textarea follow-up' });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const sendClicks = await page.evaluate(() => window.__sendClicks);
    expect(sendClicks).toBe(1);

    const lastText = await page.evaluate(() => window.__lastComposerText);
    expect(lastText).toContain('Textarea follow-up');
  });
});
