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
    __canvasEnabled: boolean;
    __deepResearchEnabled: boolean;
    __selectedModel: string;
    __thinkingLevel: string;
    __modelClicks: string[];
    __thinkingClicks: string[];
    __researchStarted: number;
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

    const modelState = await page.evaluate(() => ({
      canvasEnabled: window.__canvasEnabled,
      selectedModel: window.__selectedModel,
      thinkingLevel: window.__thinkingLevel,
      modelClicks: window.__modelClicks,
      thinkingClicks: window.__thinkingClicks,
    }));
    expect(modelState.canvasEnabled).toBe(false);
    expect(modelState.selectedModel).toContain('Pro');
    expect(modelState.thinkingLevel).toBe('Deep Think');
    expect(modelState.modelClicks).toEqual(['3.1 Pro']);
    expect(modelState.thinkingClicks).toEqual(['Deep Think']);
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

    const state = await page.evaluate(() => ({
      selectedModel: window.__selectedModel,
      thinkingLevel: window.__thinkingLevel,
    }));
    expect(state.selectedModel).toContain('Pro');
    expect(state.thinkingLevel).toBe('Deep Think');
  });

  test('research mode activates Deep Research without selecting Deep Think', async ({ page }) => {
    await loadGeminiInjector(page, { variant: 'legacy', includeDeepResearchTool: true });

    const result = await page.evaluate(async () => {
      return window.llmBurst.injectors.GEMINI.submit({
        prompt: 'Research Gemini',
        options: { research: true },
      });
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);

    const state = await page.evaluate(() => ({
      deepResearchEnabled: window.__deepResearchEnabled,
      selectedModel: window.__selectedModel,
      thinkingLevel: window.__thinkingLevel,
      modelClicks: window.__modelClicks,
      thinkingClicks: window.__thinkingClicks,
      sendClicks: window.__sendClicks,
    }));

    expect(state.deepResearchEnabled).toBe(true);
    expect(state.selectedModel).toBe('3.1 Pro');
    expect(state.thinkingLevel).toBe('Standard');
    expect(state.modelClicks).toEqual(['3.1 Pro']);
    expect(state.thinkingClicks).toEqual([]);
    expect(state.sendClicks).toBe(1);

    const researchStarted = await page.evaluate(() => window.__researchStarted);
    expect(researchStarted).toBe(1);
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
