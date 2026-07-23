import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const distPath = fileURLToPath(new URL('../dist', import.meta.url));

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-sandbox',
    ],
  });

  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extensionId = (sw as Worker).url().split('/')[2] ?? '';
  expect(extensionId).not.toBe('');
});

test.afterAll(async () => {
  await context.close();
});

function dashboardUrl(): string {
  return `chrome-extension://${extensionId}/${path.posix.join('src', 'options', 'index.html')}`;
}

test('dashboard shell renders: wordmark, project switcher, nav and credit footer', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());

  await expect(page.locator('.wordmark')).toContainText('Context Notes');
  // Project switcher shows a seeded project (either the side panel's or the dashboard's own seed).
  await expect(page.locator('#pName')).not.toHaveText('—');
  await expect(page.locator('#pName')).not.toHaveText('Loading…');

  // The five Phase 2 nav items.
  await expect(page.locator('#nav .nav-item')).toHaveCount(5);

  // Credit footer (dashboard only) with attribution and version.
  await expect(page.locator('.credit')).toContainText('dev@attv.uk');
  await expect(page.locator('#appVersion')).toContainText('v');

  await page.close();
});

test('nav routes update the topbar title', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());

  await expect(page.locator('#viewTitle')).toHaveText('Overview');

  await page.locator('#nav .nav-item[data-route="references"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('References');

  await page.locator('#nav .nav-item[data-route="documents"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('Documents');

  await page.close();
});
