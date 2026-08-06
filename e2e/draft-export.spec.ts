import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * E2E for Task 9's export — two independent delivery paths, neither provable
 * from a toast alone:
 *
 * - "Copy draft" puts BOTH real HTML and real Markdown on the clipboard.
 *   `copyDraft` (`src/options/export-draft.ts`) composes the two flavours
 *   separately and renders each through its own serialiser, so this also
 *   proves the two outputs are not one parsed out of the other (asserting the
 *   plain-text flavour carries no HTML tags is exactly what would catch that
 *   regression). `ClipboardItem` with a `text/html` entry does not exist in
 *   jsdom, so this is the only place either promise can be checked.
 * - "Download .md" hands a real file to Chrome's download manager via an
 *   `<a download>`/blob URL (`downloadMarkdown`). jsdom has no download
 *   manager either, so the suggested filename and the file's actual bytes
 *   can only be inspected here, through Playwright's `download` event.
 *
 * See `src/options/export-draft.test.ts` for the part unit tests already
 * cover (the filename rule in isolation).
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

/**
 * Wait until the dashboard's first-run seed has actually reached storage.
 *
 * `#pName` rendering only proves the project exists in the page's own state —
 * the seeding `projects/put` can still be in flight. Both tests below then ask
 * the worker for `projects/list` and index straight into `data[0]`, so on a
 * fresh profile (this spec launches its own, every run) a slow machine loses
 * that race and the seed arrives after the read.
 *
 * That is not hypothetical: it turned CI red on `main` while a warm local
 * machine stayed green, failing in 225ms with "Cannot read properties of
 * undefined (reading 'id')". The sibling `dashboard.spec.ts` uses the same
 * `#pName` wait and survives only because its earlier tests have already
 * forced the write to land — which makes its first reader latently fragile
 * in the same way.
 *
 * The outline is part of the condition because the tests need a section id
 * from it, and a project written without one would satisfy a bare length check.
 */
async function waitForSeededProject(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const res = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
            data?: Array<{ id?: string; outline?: Array<{ id: string }> }>;
          };
          const project = res.data?.[0];
          return Boolean(project?.id) && (project?.outline?.length ?? 0) > 0;
        }),
      { message: 'the dashboard never persisted its first-run project' },
    )
    .toBe(true);
}

test('copying a draft puts real markup on the clipboard', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await waitForSeededProject(page);

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
    // Anchored at the start: the degraded-clipboard message also contains
    // "copied" ("Copied without formatting — the bibliography's italics need
    // fixing by hand"), so only pinning the match to the very beginning of
    // the toast text tells the success path apart from the fallback one —
    // an unanchored /copied/i would pass on either.
    await expect(page.locator('.toast')).toContainText(/^Draft copied/i);

    // The only proof that survives: read both flavours back out.
    const { html, plain } = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      let html = '';
      let plain = '';
      for (const item of items) {
        if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
        if (item.types.includes('text/plain'))
          plain = await (await item.getType('text/plain')).text();
      }
      return { html, plain };
    });
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h2>');
    // The passage's own quote and the reference's real citeproc bibliography
    // entry both made it across — not just matching tags.
    expect(html).toContain('the observed passage');
    expect(html).toContain('Oke');

    // `text/plain` comes from a SEPARATE `'text'`-flavour compose through
    // `draftToMarkdown`, not from stripping the html string — so it must be
    // real Markdown (a `>` blockquote marker) and carry no HTML tags at all.
    expect(plain).toContain('> the observed passage');
    expect(plain).toContain('Oke');
    expect(plain).not.toContain('<blockquote>');
    expect(plain).not.toContain('<h2>');
  } finally {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-export-doc' });
      await chrome.runtime.sendMessage({ type: 'references/delete', id: 'e2e-export-ref' });
      await chrome.runtime.sendMessage({ type: 'annotations/delete', id: 'e2e-export-anno' });
    });
  }

  await page.close();
});

test('a clipboard write the browser refuses still lands the plain text, with an honest toast', async () => {
  const page = await context.newPage();
  // `copyDraft`'s `catch` → `writeText` fallback (src/options/export-draft.ts)
  // is the path CHANGELOG.md promises but the earlier test above never
  // exercises — it only ever sees the rich write succeed. Playwright has no
  // built-in way to make a real browser refuse `navigator.clipboard.write`,
  // so the API is monkeypatched to reject instead, the same technique
  // `e2e/webannotation.spec.ts`'s `stubActiveTabScan` uses (an
  // `addInitScript` that replaces a Chrome/Web API before the page's own
  // scripts run). `writeText` is left untouched, so the fallback's own write
  // still lands and can be read back.
  await page.addInitScript(() => {
    navigator.clipboard.write = () => Promise.reject(new Error('e2e: rich write refused'));
  });
  await page.goto(dashboardUrl());
  await waitForSeededProject(page);

  // Same shape as the clipboard fixture above, with its own ids — this
  // test's cleanup must not depend on the other test's having run, or having
  // cleaned up correctly, first.
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
        id: 'e2e-export-fallback-doc',
        projectId,
        url: 'https://example.org/export-fallback-source',
        type: 'article',
        metadata: { title: 'Export fallback source', authors: ['Oke, T. R.'], year: 1982 },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'references/put',
      reference: {
        id: 'e2e-export-fallback-ref',
        projectId,
        documentId: 'e2e-export-fallback-doc',
        cslData: {
          type: 'article-journal',
          title: 'Export fallback source',
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
        id: 'e2e-export-fallback-anno',
        projectId,
        documentId: 'e2e-export-fallback-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'the degraded passage' }] },
        content: 'A note on the degraded passage',
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
    await page.locator('#nav .nav-item[data-route="outline"]').click();
    await page.getByRole('button', { name: /copy draft/i }).click();
    // The honest toast, not the success one — this is exactly the text the
    // success test's own `/^Draft copied/i` anchor is written to exclude.
    await expect(page.locator('.toast')).toContainText(/^Copied without formatting/i);

    // The rich write never happened (it was made to reject), but the plain
    // text still landed via the fallback's own `writeText` call.
    const plain = await page.evaluate(() => navigator.clipboard.readText());
    expect(plain).toContain('> the degraded passage');
    expect(plain).toContain('Oke');
    expect(plain).not.toContain('<blockquote>');
  } finally {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-export-fallback-doc' });
      await chrome.runtime.sendMessage({
        type: 'references/delete',
        id: 'e2e-export-fallback-ref',
      });
      await chrome.runtime.sendMessage({
        type: 'annotations/delete',
        id: 'e2e-export-fallback-anno',
      });
    });
  }

  await page.close();
});

test('downloading the .md draft produces a real Markdown file with no HTML in it', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await waitForSeededProject(page);

  // Same shape as the clipboard fixture above (one document, one reference
  // tied to it, one quoted and sectioned annotation) but with its own ids —
  // this test's cleanup must not depend on the other test's having run, or
  // having cleaned up correctly, first.
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
        id: 'e2e-export-md-doc',
        projectId,
        url: 'https://example.org/export-md-source',
        type: 'article',
        metadata: { title: 'Export md source', authors: ['Oke, T. R.'], year: 1982 },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'references/put',
      reference: {
        id: 'e2e-export-md-ref',
        projectId,
        documentId: 'e2e-export-md-doc',
        cslData: {
          type: 'article-journal',
          title: 'Export md source',
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
        id: 'e2e-export-md-anno',
        projectId,
        documentId: 'e2e-export-md-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'the markdown passage' }] },
        content: 'A note on the markdown passage',
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
    await page.locator('#nav .nav-item[data-route="outline"]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /download \.md/i }).click();
    const download = await downloadPromise;

    // `draftFilename`'s shape (`src/options/export-draft.ts`): a slug of the
    // project name seeded at `src/options/main.ts`'s `makeProject('My
    // Research Project')`, plus today's date.
    expect(download.suggestedFilename()).toMatch(
      /^draft-my-research-project-\d{4}-\d{2}-\d{2}\.md$/,
    );

    const filePath = await download.path();
    if (!filePath) throw new Error('Chromium produced no local path for the download');
    const body = await fs.promises.readFile(filePath, 'utf-8');

    // Real Markdown from `draftToMarkdown` — a section heading and a
    // blockquote line — not a toast's word for it.
    expect(body).toContain('## ');
    expect(body).toContain('> the markdown passage');
    expect(body).toContain('Oke');
    // Proof this was composed with `flavour: 'text'` and not the clipboard
    // action's `'html'`-flavour draft stripped down after the fact: no HTML
    // tag survives in a real Markdown render.
    expect(body).not.toMatch(/<[a-zA-Z/][^>]*>/);
  } finally {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-export-md-doc' });
      await chrome.runtime.sendMessage({ type: 'references/delete', id: 'e2e-export-md-ref' });
      await chrome.runtime.sendMessage({ type: 'annotations/delete', id: 'e2e-export-md-anno' });
    });
  }

  await page.close();
});
