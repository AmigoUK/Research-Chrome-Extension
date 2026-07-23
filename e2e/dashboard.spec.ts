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

test('Documents view filters rows by search text', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    const mk = (id: string, title: string) => ({
      id,
      projectId,
      url: `https://example.org/${id}`,
      type: 'article',
      metadata: { title, authors: ['Doe, J.'], year: 2024, journal: 'Journal' },
      status: 'toRead',
      section: 'Literature',
      createdAt: now,
      updatedAt: now,
    });
    await chrome.runtime.sendMessage({ type: 'documents/put', document: mk('e2e-docs-heat', 'Urban heat island effects') });
    await chrome.runtime.sendMessage({ type: 'documents/put', document: mk('e2e-docs-air', 'Air quality monitoring dataset') });
  });
  await page.reload();

  await page.locator('#nav .nav-item[data-route="documents"]').click();
  await expect(page.locator('.tbl tbody tr')).not.toHaveCount(0);

  await page.locator('#q').fill('heat island');
  await expect(page.locator('.tbl tbody tr[data-id="e2e-docs-heat"]')).toBeVisible();
  await expect(page.locator('.tbl tbody tr[data-id="e2e-docs-air"]')).toHaveCount(0);

  await page.close();
});

test('References view lists stored references and offers a DOI import form', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'references/put',
      reference: {
        id: 'e2e-ref-1',
        projectId,
        cslData: {
          type: 'article-journal',
          title: 'Reference under test',
          author: [{ family: 'Oke', given: 'T. R.' }],
          issued: { 'date-parts': [[1982]] },
          'container-title': 'QJRMS',
          DOI: '10.1002/qj.49710845502',
        },
        source: 'manual',
        usedInOutputs: [],
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  await page.locator('#nav .nav-item[data-route="references"]').click();
  await expect(page.locator('.tbl tbody tr[data-id="e2e-ref-1"] .ttl')).toHaveText(
    'Reference under test',
  );

  // Import popover: DOI is actionable, BibTeX/RIS/Zotero are disabled "Soon".
  await page.locator('#rImport').click();
  await expect(page.locator('#pop .imp-src[data-doi]')).toBeVisible();
  await expect(page.locator('#pop .imp-src[disabled]').first()).toBeVisible();

  await page.locator('#pop .imp-src[data-doi]').click();
  await expect(page.locator('#pop #doiInput')).toBeVisible();

  await page.close();
});

test('Annotations view changes a note review status and persists it', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-anno-1',
        projectId,
        documentId: 'nope',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'a quoted passage' }] },
        content: 'A note to reclassify',
        tags: ['review'],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  await page.locator('#nav .nav-item[data-route="annotations"]').click();
  const card = page.locator('.anno[data-id="e2e-anno-1"]');
  await expect(card.locator('[data-status]')).toHaveText('Draft');

  await card.locator('[data-status]').click();
  await page.locator('#pop [data-set="accepted"]').click();
  await expect(card.locator('[data-status]')).toHaveText('Accepted');

  await page.reload();
  await page.locator('#nav .nav-item[data-route="annotations"]').click();
  await expect(page.locator('.anno[data-id="e2e-anno-1"] [data-status]')).toHaveText('Accepted');

  await page.close();
});

test('Kanban advances a card status with the arrow keys and persists it', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Seed a fresh source in "toRead".
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-kanban-1',
        projectId,
        url: 'https://example.org/kanban',
        type: 'article',
        metadata: { title: 'Kanban keyboard move', authors: ['Mover, K.'], year: 2026 },
        status: 'toRead',
        section: 'Literature',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  const card = page.locator('.kcard[data-id="e2e-kanban-1"]');
  await card.focus();
  await card.press('ArrowRight');

  // Card moved into the "In review" column and the pill reflects it.
  await expect(
    page.locator('.kcol[data-col="inReview"] .kcard[data-id="e2e-kanban-1"] .spill'),
  ).toContainText('In review');

  // Persisted through a reload.
  await page.reload();
  await expect(
    page.locator('.kcol[data-col="inReview"] .kcard[data-id="e2e-kanban-1"]'),
  ).toBeVisible();

  await page.close();
});
