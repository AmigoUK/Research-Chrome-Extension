import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * E2E for Task 9's export: "Copy draft" puts real HTML on the clipboard, not
 * just a toast claiming it did. `ClipboardItem` with a `text/html` entry does
 * not exist in jsdom, so this is the only place that promise can be checked —
 * see `src/options/export-draft.ts` and `src/options/export-draft.test.ts`
 * for the parts that unit tests already cover (the filename rule).
 */

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

  // Granted on the context, not a page: `navigator.clipboard.read()` runs
  // from `page.evaluate` after the click below, and a page-scoped grant
  // would not cover that origin's clipboard access for the read-back. No
  // `origin` option — Chromium's `Browser.grantPermissions` rejects a
  // `chrome-extension://` origin as opaque, so the grant has to be global.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test.afterAll(async () => {
  await context.close();
});

function dashboardUrl(): string {
  return `chrome-extension://${extensionId}/${path.posix.join('src', 'options', 'index.html')}`;
}

test('copying a draft puts real markup on the clipboard', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // One document, one reference tied to it (so the bibliography is real
  // citeproc output, not empty), and one quoted, sectioned annotation — the
  // minimum a draft needs to render a `<blockquote>` under a real `<h2>`.
  await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string; outline: Array<{ id: string }> }>;
    };
    const project = projects.data[0]!;
    const projectId = project.id;
    const sectionId = project.outline[0]!.id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-export-doc',
        projectId,
        url: 'https://example.org/export-source',
        type: 'article',
        metadata: { title: 'Export source', authors: ['Oke, T. R.'], year: 1982 },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'references/put',
      reference: {
        id: 'e2e-export-ref',
        projectId,
        documentId: 'e2e-export-doc',
        cslData: {
          type: 'article-journal',
          title: 'Export source',
          author: [{ family: 'Oke', given: 'T. R.' }],
          issued: { 'date-parts': [[1982]] },
          'container-title': 'QJRMS',
        },
        source: 'manual',
        usedInOutputs: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-export-anno',
        projectId,
        documentId: 'e2e-export-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'the observed passage' }] },
        content: 'A note on the observed passage',
        tags: [],
        status: 'draft',
        author: 'me',
        section: sectionId,
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  try {
    // Nav items are buttons, not links — `#nav .nav-item[data-route]` is the
    // pattern every other spec in this suite uses (`e2e/dashboard.spec.ts`).
    await page.locator('#nav .nav-item[data-route="outline"]').click();
    await page.getByRole('button', { name: /copy draft/i }).click();
    await expect(page.locator('.toast')).toContainText(/copied/i);

    // The only proof that survives: read the html flavour back out.
    const html = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          return await (await item.getType('text/html')).text();
        }
      }
      return '';
    });
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h2>');
    // The passage's own quote and the reference's real citeproc bibliography
    // entry both made it across — not just matching tags.
    expect(html).toContain('the observed passage');
    expect(html).toContain('Oke');
  } finally {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-export-doc' });
      await chrome.runtime.sendMessage({ type: 'references/delete', id: 'e2e-export-ref' });
    });
  }

  await page.close();
});
