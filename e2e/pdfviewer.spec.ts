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

async function seedPdfDocument(docId: string): Promise<void> {
  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await seed.evaluate(
    async ([id, dataBase64]) => {
      const now = new Date().toISOString();
      await chrome.runtime.sendMessage({
        type: 'files/put',
        file: { id: `${id}-file`, name: 'sample.pdf', mime: 'application/pdf', dataBase64 },
      });
      await chrome.runtime.sendMessage({
        type: 'documents/put',
        document: {
          id,
          projectId: 'e2e-project',
          url: 'file://sample.pdf',
          fileId: `${id}-file`,
          type: 'pdf',
          metadata: { title: `Doc ${id}` },
          status: 'toRead',
          createdAt: now,
          updatedAt: now,
        },
      });
    },
    [docId, sampleBase64] as const,
  );
  await seed.close();
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

test('a stored PDF text anchor renders as an overlay and rail card, and edits persist', async () => {
  await seedPdfDocument('e2e-anno-doc');
  // Seed a PDF text annotation on page 1 directly.
  const seed = await context.newPage();
  await seed.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await seed.evaluate(async () => {
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-pdf-anno',
        projectId: 'e2e-project',
        documentId: 'e2e-anno-doc',
        anchor: {
          kind: 'pdf',
          selectors: [
            { type: 'pdfRegion', page: 1, rects: [{ page: 1, left: 0.1, top: 0.1, width: 0.5, height: 0.06 }], quote: 'Hello Context Notes' },
          ],
        },
        content: '',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await seed.close();

  const page = await context.newPage();
  await page.goto(viewerUrl('e2e-anno-doc'));
  await expect(page.locator('.pdf-page canvas')).toBeVisible();

  // Overlay resolved from fraction rects, and a rail card with the quote.
  await expect(page.locator('.anno-layer .ov.text')).toBeVisible();
  const card = page.locator('.ac[data-id="e2e-pdf-anno"]');
  await expect(card.locator('.quote')).toHaveText('Hello Context Notes');

  // Edit note + status, then verify persistence after reload.
  await card.locator('.note-ta').fill('a persisted note');
  await card.locator('[data-stat]').selectOption('accepted');
  await page.waitForTimeout(700); // debounced note save

  await page.reload();
  const card2 = page.locator('.ac[data-id="e2e-pdf-anno"]');
  await expect(card2.locator('.note-ta')).toHaveValue('a persisted note');
  await expect(card2.locator('[data-stat]')).toHaveValue('accepted');

  await page.close();
});

test('selecting text and clicking Highlight creates a persisted anchor', async () => {
  await seedPdfDocument('e2e-select-doc');
  const page = await context.newPage();
  await page.goto(viewerUrl('e2e-select-doc'));
  await expect(page.locator('.textLayer span')).not.toHaveCount(0);

  // Select the first text span and fire mouseup (as a real drag-select would).
  await page.locator('.textLayer span').first().selectText();
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));

  await expect(page.locator('#seltool.on')).toBeVisible();
  await page.locator('#seltool button', { hasText: 'Highlight' }).click();

  await expect(page.locator('.anno-layer .ov.text')).toBeVisible();
  await expect(page.locator('#railList .ac')).not.toHaveCount(0);

  await page.close();
});

test('dashboard "Add PDF" uploads a file, creates a pdf document, and opens the reader', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await expect(page.locator('#pName')).not.toHaveText('—');
  await page.locator('#nav .nav-item[data-route="documents"]').click();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#addPdf').click(),
  ]);
  const [reader] = await Promise.all([
    context.waitForEvent('page'),
    chooser.setFiles(fixturePath),
  ]);

  // A reader tab opened on the new document and rendered the PDF.
  expect(reader.url()).toContain('src/pdfviewer/index.html?documentId=');
  await reader.waitForSelector('.pdf-page canvas');

  // The dashboard Documents table now has the uploaded PDF with an Open action.
  const row = page.locator('.tbl tbody tr', { hasText: 'sample' });
  await expect(row).toBeVisible();
  await expect(row.locator('[data-open]')).toBeVisible();

  await reader.close();
  await page.close();
});

test('dragging a region in Region mode anchors a rectangle that persists', async () => {
  await seedPdfDocument('e2e-region-doc');
  const page = await context.newPage();
  await page.goto(viewerUrl('e2e-region-doc'));
  await expect(page.locator('.pdf-page canvas')).toBeVisible();

  await page.locator('#modeSeg button[data-mode="region"]').click();
  const box = await page.locator('.pdf-page').boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 120, { steps: 8 });
    await page.mouse.up();
  }

  await expect(page.locator('#seltool.on')).toBeVisible();
  await page.locator('#seltool button', { hasText: 'Anchor region' }).click();

  await expect(page.locator('.anno-layer .ov.region')).toBeVisible();
  await expect(page.locator('#railList .ac .ac-kind', { hasText: 'Region' })).toBeVisible();

  // Persists across reload.
  await page.reload();
  await expect(page.locator('.anno-layer .ov.region')).toBeVisible();

  await page.close();
});
