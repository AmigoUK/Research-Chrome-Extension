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

function panelUrl(): string {
  return `chrome-extension://${extensionId}/${path.posix.join('src', 'sidepanel', 'index.html')}`;
}

test('side panel renders and seeds a default project with an empty reading list', async () => {
  const page = await context.newPage();
  await page.goto(panelUrl());

  await expect(page.locator('.wordmark')).toContainText('Context Notes');
  await expect(page.locator('#activeName')).toHaveText('My Research');
  await expect(page.locator('.empty__t')).toHaveText('No sources filed yet');
  await page.close();
});

test('a filed document appears in the reading list and updates progress', async () => {
  const page = await context.newPage();
  await page.goto(panelUrl());
  await expect(page.locator('#activeName')).toHaveText('My Research');

  // Drive the full messaging → router → IndexedDB path from the page context.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-doc-1',
        projectId,
        url: 'https://example.org/e2e',
        type: 'article',
        metadata: { title: 'End-to-end test source', authors: ['Tester, A.'], year: 2026 },
        status: 'analysed',
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  await page.reload();
  await expect(page.locator('.doc__title')).toContainText('End-to-end test source');
  await expect(page.locator('#progVal')).toContainText('1/1 analysed');
  await page.close();
});

test('the status menu moves a source backwards, which cycling never could', async () => {
  const page = await context.newPage();
  await page.goto(panelUrl());
  await expect(page.locator('#activeName')).toHaveText('My Research');

  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-status-menu',
        projectId,
        url: 'https://example.org/status',
        type: 'article',
        metadata: { title: 'Status menu source', authors: ['Mover, K.'], year: 2026 },
        status: 'analysed',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  const statusBtn = page.locator('[data-od-id="status-e2e-status-menu"]');
  await expect(statusBtn).toContainText('Analysed');

  // The menu offers the whole pipeline, marking where the source is now.
  await statusBtn.click();
  await expect(page.locator('#statusMenu .smenu__item')).toHaveCount(4);
  await expect(page.locator('#statusMenu .smenu__item.is-current')).toContainText('Analysed');

  // Move it *back* — the old click-cycling could only ever go forward.
  await page.locator('#statusMenu [data-status="toRead"]').click();
  await expect(statusBtn).toContainText('To read');

  await page.reload();
  await expect(page.locator('[data-od-id="status-e2e-status-menu"]')).toContainText('To read');

  // Escape dismisses the menu without changing anything.
  await page.locator('[data-od-id="status-e2e-status-menu"]').click();
  await expect(page.locator('#statusMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#statusMenu')).toHaveCount(0);
  await expect(page.locator('[data-od-id="status-e2e-status-menu"]')).toContainText('To read');

  await page.close();
});
