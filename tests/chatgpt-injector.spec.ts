import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChatGPTFixture, type ChatGPTFixtureOptions } from './fixtures/chatgptPage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const utilsPath = resolve(projectRoot, 'chrome_ext/content/injectors/utils.js');
const chatgptPath = resolve(projectRoot, 'chrome_ext/content/injectors/chatgpt.js');

declare global {
  interface Window {
    llmBurst: {
      injectors: Record<string, any>;
    };
    __sendClicks: number;
    __submittedText: string;
    __researchActivationRequests: number;
  }
}

async function loadChatGPTInjector(page: Page, options: ChatGPTFixtureOptions = {}) {
  await page.setContent(createChatGPTFixture(options));
  await page.addScriptTag({ path: utilsPath });
  await page.addScriptTag({ path: chatgptPath });
  await page.waitForFunction(() => Boolean(window.llmBurst?.injectors?.CHATGPT));
}

test.describe('ChatGPT injector', () => {
  test('submits prompt with current composer submit button', async ({ page }) => {
    await loadChatGPTInjector(page);

    await page.evaluate(async () => {
      await window.llmBurst.injectors.CHATGPT.submit({
        prompt: 'What does Dan Raffle do?',
        options: {},
      });
    });

    const state = await page.evaluate(() => ({
      sendClicks: window.__sendClicks,
      submittedText: window.__submittedText,
    }));

    expect(state.sendClicks).toBe(1);
    expect(state.submittedText).toContain('What does Dan Raffle do?');
  });

  test('submits after trusted research activation', async ({ page }) => {
    await loadChatGPTInjector(page, { mockResearchActivation: true });

    await page.evaluate(async () => {
      await window.llmBurst.injectors.CHATGPT.submit({
        prompt: 'Research Dan Raffle',
        options: { research: true },
      });
    });

    const state = await page.evaluate(() => ({
      researchRequests: window.__researchActivationRequests,
      sendClicks: window.__sendClicks,
      submittedText: window.__submittedText,
    }));

    expect(state.researchRequests).toBe(1);
    expect(state.sendClicks).toBe(1);
    expect(state.submittedText).toContain('Research Dan Raffle');
  });
});
