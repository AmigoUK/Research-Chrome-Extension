import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const distPath = fileURLToPath(new URL('../dist', import.meta.url));
const fixturePath = fileURLToPath(new URL('./fixtures/sample.pdf', import.meta.url));
const sampleBase64 = readFileSync(fixturePath).toString('base64');

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

function viewerUrl(documentId: string): string {
  return `chrome-extension://${extensionId}/${path.posix.join('src', 'pdfviewer', 'index.html')}?documentId=${documentId}`;
}

test('PDF reader renders a stored PDF to a canvas', async () => {
  const seed = await context.newPage();
  // Any extension page can drive the message router; use the options page.
  await seed.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await seed.evaluate(async (dataBase64: string) => {
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'files/put',
      file: { id: 'e2e-file-1', name: 'sample.pdf', mime: 'application/pdf', dataBase64 },
    });
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-pdf-doc',
        projectId: 'e2e-project',
        url: 'file://sample.pdf',
        fileId: 'e2e-file-1',
        type: 'pdf',
        metadata: { title: 'Sample PDF under test' },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
  }, sampleBase64);
  await seed.close();

  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(viewerUrl('e2e-pdf-doc'));

  await expect(page.locator('#docTitle')).toHaveText('Sample PDF under test');
  const canvas = page.locator('.pdf-page canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box && box.width).toBeGreaterThan(0);
  await expect(page.locator('#pgTot')).toHaveText('1');

  // No worker/CSP errors while rendering.
  expect(errors.join('\n')).not.toMatch(/worker|Content Security Policy|Failed to fetch/i);

  await page.close();
});
