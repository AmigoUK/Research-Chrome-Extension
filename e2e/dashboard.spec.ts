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

  // Eight nav items: the five Phase 2 views, Outline (draft & export), Team
  // (Phase 5) and Settings.
  await expect(page.locator('#nav .nav-item')).toHaveCount(8);

  // Credit footer (dashboard only) with attribution and version.
  await expect(page.locator('.credit')).toContainText('dev@attv.uk');
  await expect(page.locator('#appVersion')).toContainText('v');

  await page.close();
});

test('the extension declares icons and every declared file actually loads', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());

  // A manifest can name an icon that was never built; Chrome then falls back to
  // the default puzzle piece and says nothing. So check the bytes, not the JSON.
  const icons = await page.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    const declared = { ...manifest.icons, ...(manifest.action?.default_icon as object) };
    const checked: Record<string, { status: number; bytes: number }> = {};
    for (const [size, path] of Object.entries(declared)) {
      const res = await fetch(chrome.runtime.getURL(path as string));
      checked[size] = { status: res.status, bytes: (await res.blob()).size };
    }
    return { declared, checked };
  });

  expect(Object.keys(icons.declared).sort()).toEqual(['128', '16', '32', '48']);
  for (const [size, result] of Object.entries(icons.checked)) {
    expect(result.status, `icon ${size} status`).toBe(200);
    expect(result.bytes, `icon ${size} bytes`).toBeGreaterThan(100);
  }

  await page.close();
});

test('the extension exposes nothing to the open web', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());

  // Every `web_accessible_resource` is a way for any site to detect this
  // extension and read the listed files. The reader is opened from an extension
  // page and the CSL assets are fetched same-origin, so the list should be empty.
  const war = await page.evaluate(() => chrome.runtime.getManifest().web_accessible_resources);
  expect(war ?? []).toEqual([]);

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
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: mk('e2e-docs-heat', 'Urban heat island effects'),
    });
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: mk('e2e-docs-air', 'Air quality monitoring dataset'),
    });
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

  // Import opens the DOI form directly — the only source that exists. The
  // popover used to advertise Zotero/BibTeX/RIS as disabled "Soon" stubs.
  await page.locator('#rImport').click();
  await expect(page.locator('#pop #doiInput')).toBeVisible();
  await expect(page.locator('#pop .imp-src[disabled]')).toHaveCount(0);

  await page.close();
});

test('a project with no highlights yet still shows its outline, and Add section works there', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Runs before any other test in this file gives the seeded project a
  // highlight, so the project's own annotation list is genuinely empty here
  // — the exact state that used to render "Nothing to outline yet" and
  // nothing else, hiding the sections `#olAdd` was quietly still adding to.
  await page.locator('#nav .nav-item[data-route="outline"]').click();

  // The default five sections, each honestly at zero — not a blanked-out
  // "nothing here" screen. An empty section is the one signal this view
  // exists to show; hiding it behind an all-or-nothing empty state was the bug.
  await expect(page.locator('.ol-sec[data-sec]')).toHaveCount(5);
  await expect(page.locator('.ol-warn')).toHaveCount(5);

  // The relocated empty-state copy: still says nothing has been collected,
  // now alongside the sections rather than instead of them.
  await expect(page.locator('.ol-notice')).toContainText('Nothing to outline yet');
  await expect(page.locator('.ol-notice')).toContainText(
    'Highlight passages while you read and they collect here, ready to arrange.',
  );

  // Add section is live, not disabled — the student's intent is legitimate
  // even before their first highlight — and the new section renders at once,
  // with no reload needed to see it.
  await expect(page.locator('#olAdd')).toBeEnabled();
  await page.locator('#olAdd').click();
  await page.locator('#secTitle').fill('Methodology');
  await page.locator('#secAdd').click();
  await expect(page.locator('.ol-sec h3', { hasText: 'Methodology' })).toBeVisible();
  await expect(page.locator('.ol-sec[data-sec]')).toHaveCount(6);

  // Persists — this was never the bug, but a section that vanished on
  // reload would be just as unfindable as one that never rendered.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="outline"]').click();
  await expect(page.locator('.ol-sec h3', { hasText: 'Methodology' })).toBeVisible();

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

test('deleting a section keeps its passages, as unplaced', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // One document, three passages: two filed under DIFFERENT real sections
  // (so a delete-with-move can be checked against a bystander section left
  // untouched), and a third alongside the second so that section's own
  // delete confirmation exercises the plural wording, not just the singular
  // one the first section's solo passage gives. Section ids come from the
  // project's own default outline, read back rather than guessed, so this
  // does not depend on how ids are derived from section titles.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const project = projects.data[0];
    const projectId = project.id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-outline-doc',
        projectId,
        url: 'https://example.org/outline-source',
        type: 'article',
        metadata: {
          title: 'Outline source',
          authors: ['Doe, J.'],
          year: 2024,
          journal: 'Journal',
        },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    const mkAnno = (id: string, section: string) => ({
      id,
      projectId,
      documentId: 'e2e-outline-doc',
      anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: `passage for ${id}` }] },
      content: `Note for ${id}`,
      tags: [],
      status: 'draft',
      author: 'me',
      section,
      createdAt: now,
      updatedAt: now,
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: mkAnno('e2e-outline-anno-1', project.outline[0].id),
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: mkAnno('e2e-outline-anno-2', project.outline[1].id),
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: mkAnno('e2e-outline-anno-3', project.outline[1].id),
    });
  });
  await page.reload();

  // In `finally` so a failed assertion below still cleans up: this suite's
  // tests share one persistent profile and never reset storage between them
  // (see the neighbouring tests), and leaving these rows behind on a failure
  // would re-create exactly the cross-test interference already debugged
  // once — see the cleanup comment below.
  try {
    await page.locator('#nav .nav-item[data-route="outline"]').click();
    await expect(page.locator('.ol-sec[data-sec]').first()).toBeVisible();

    // Scoped by data-id rather than by a raw `.anno` count: earlier tests in
    // this file leave their own unsectioned annotations behind in the shared
    // profile, and those already sit in Unplaced — a bare count would be
    // polluted by them. Real sections carry only `.ol-sec`; Unplaced carries
    // `.ol-sec` AND `.ol-sec--loose`, so `:not(.ol-sec--loose)` isolates them.
    const anno1InASection = page.locator(
      '.ol-sec:not(.ol-sec--loose) .anno[data-id="e2e-outline-anno-1"]',
    );
    const anno1InUnplaced = page.locator('.ol-sec--loose .anno[data-id="e2e-outline-anno-1"]');
    const anno2InASection = page.locator(
      '.ol-sec:not(.ol-sec--loose) .anno[data-id="e2e-outline-anno-2"]',
    );
    const anno2InUnplaced = page.locator('.ol-sec--loose .anno[data-id="e2e-outline-anno-2"]');
    const anno3InUnplaced = page.locator('.ol-sec--loose .anno[data-id="e2e-outline-anno-3"]');

    // Both passages start filed under a real section, not Unplaced.
    await expect(anno1InASection).toHaveCount(1);
    await expect(anno2InASection).toHaveCount(1);
    await expect(anno1InUnplaced).toHaveCount(0);

    // The first section in outline order holds e2e-outline-anno-1 alone —
    // its confirmation must read the singular form.
    const firstSectionId = await page.locator('[data-delsec]').first().getAttribute('data-delsec');
    await page.locator('[data-delsec]').first().click();
    await expect(page.locator('.pop-confirm')).toHaveText(
      '1 passage will move to Unplaced. This cannot be undone.',
    );
    await page.getByRole('button', { name: /delete section/i }).click();

    // Its passage survives — now in Unplaced, not gone — while the OTHER
    // section's passages are untouched by a deletion that was not their own.
    await expect(anno1InUnplaced).toHaveCount(1);
    await expect(anno1InASection).toHaveCount(0);
    await expect(anno2InASection).toHaveCount(1);

    // The section that used to be second is now first, holding both anno-2
    // and anno-3 — its confirmation must read the plural form.
    await page.locator('[data-delsec]').first().click();
    await expect(page.locator('.pop-confirm')).toHaveText(
      '2 passages will move to Unplaced. This cannot be undone.',
    );
    await page.getByRole('button', { name: /delete section/i }).click();
    await expect(anno2InUnplaced).toHaveCount(1);
    await expect(anno3InUnplaced).toHaveCount(1);
    await expect(anno2InASection).toHaveCount(0);

    // Persists: a reload re-reads the state `projects/put` actually wrote,
    // not just the optimistic in-memory update `mutateOutline` made — a
    // write that silently failed to land would still pass every assertion
    // above.
    await page.reload();
    await page.locator('#nav .nav-item[data-route="outline"]').click();
    await expect(page.locator(`.ol-sec[data-sec="${firstSectionId}"]`)).toHaveCount(0);
    await expect(anno1InUnplaced).toHaveCount(1);
    await expect(anno2InUnplaced).toHaveCount(1);
    await expect(anno3InUnplaced).toHaveCount(1);
  } finally {
    // Deleting the document cascades to its annotations (`documents/delete`'s
    // own contract), so the Annotations list a LATER, unrelated test reads
    // back is the length it was before this test ran — otherwise these extra
    // rows lengthen that list enough to push a later test's target row below
    // the fold, which was observed to intermittently break that other test's
    // popover interaction (a scroll event closing the popover mid-click —
    // see `closePop`'s callers).
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-outline-doc' });
    });
  }

  await page.close();
});

test('a project not yet organised by section is grouped by colour, and the screen says so', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Two passages, neither ever assigned a section — the exact state
  // `groupPassages` treats as "not organised yet", where it falls back to
  // grouping (and citing) by highlight colour instead of by outline.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-colour-doc',
        projectId,
        url: 'https://example.org/colour-source',
        type: 'article',
        metadata: { title: 'Colour source', authors: ['Hue, C.'], year: 2024 },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-colour-yellow',
        projectId,
        documentId: 'e2e-colour-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'a yellow passage' }] },
        content: 'Coloured, unsectioned',
        color: 'yellow',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-colour-none',
        projectId,
        documentId: 'e2e-colour-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'a colourless passage' }] },
        content: 'Neither coloured nor sectioned',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  try {
    await page.locator('#nav .nav-item[data-route="outline"]').click();

    // The screen says what will actually happen to the export, not merely
    // that something is unassigned.
    await expect(page.locator('.ol-notice--accent')).toContainText('colour');

    // `groupPassages`'s own definition of "unplaced" in this mode is
    // colour-orphaned, not section-orphaned: the coloured passage is
    // accounted for by its colour bucket, not shown as Unplaced here. If
    // this screen ever goes back to re-implementing the predicate instead of
    // calling `groupPassages`, this is what drifts first.
    await expect(page.locator('.ol-sec--loose .anno[data-id="e2e-colour-none"]')).toHaveCount(1);
    await expect(page.locator('.anno[data-id="e2e-colour-yellow"]')).toHaveCount(0);
  } finally {
    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'documents/delete', id: 'e2e-colour-doc' });
    });
  }

  await page.close();
});

test('an outline edit on a project with no stored outline persists the derived default plus the edit', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Force the "no stored outline" branch: `resolveOutline` derives the
  // five-section default from scratch whenever `project.outline` is absent
  // — the only way `mutateOutline`'s first-write path (deriving the outline,
  // applying the edit, and persisting the RESULT in one write) actually
  // runs. Every other test in this file seeds a project that already has a
  // stored outline (`makeProject` always sets one), so this branch is
  // otherwise never exercised.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const project = projects.data[0];
    delete project.outline;
    await chrome.runtime.sendMessage({ type: 'projects/put', project });
  });
  await page.reload();

  await page.locator('#nav .nav-item[data-route="outline"]').click();
  // The derived default's first section, shown despite nothing being stored
  // yet — `.ol-sec[data-sec]` excludes the Unplaced block (it never carries
  // `data-sec`), so this is a real section, not "Unplaced (N)".
  await expect(page.locator('.ol-sec[data-sec]')).toHaveCount(5);
  await expect(page.locator('.ol-sec[data-sec] h3').first()).toContainText('Introduction');

  // Rename it — the first-ever outline mutation for this project.
  // `mutateOutline` must derive the default, apply the rename, and persist
  // the RESULT (five sections, one renamed) in that same write — not persist
  // the transient default and drop the rename, and not apply the rename to a
  // default that never gets saved.
  await page.locator('[data-rename]').first().click();
  await page.locator('#secRename').fill('Framing');
  await page.locator('#secRenameGo').click();
  await expect(page.locator('.ol-sec[data-sec] h3').first()).toContainText('Framing');

  await page.reload();
  await page.locator('#nav .nav-item[data-route="outline"]').click();
  await expect(page.locator('.ol-sec[data-sec] h3').first()).toContainText('Framing');
  await expect(page.locator('.ol-sec[data-sec]')).toHaveCount(5);

  await page.close();
});

test('Citation styles editor saves a rule change that persists', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await expect(page.locator('.style-list .style-card')).not.toHaveCount(0);

  // Toggle "Include URL" on and save.
  const urlSwitch = page.locator('#swUrl');
  const before = await urlSwitch.getAttribute('aria-checked');
  await urlSwitch.click();
  await expect(urlSwitch).not.toHaveAttribute('aria-checked', before ?? '');
  await page.locator('#sSave').click();

  // Persisted after reload.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await expect(page.locator('#swUrl')).not.toHaveAttribute('aria-checked', before ?? '');

  await page.close();
});

test('Full style editor: a rule change moves the real citeproc preview and persists', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await page.locator('#sFull').click();

  // Full-screen workspace: app shell steps aside, profile rail + rule groups show.
  await expect(page.locator('#viewTitle')).toHaveText('Style editor');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.credit')).toBeHidden();
  await expect(page.locator('.sed-rules .grp')).toHaveCount(5);

  // The preview is formatted by citeproc in the service worker, not hand-rolled.
  // The seeded profile truncates at 3 authors, so the 4-author sample says "et al.".
  const fourAuthors = page.locator('.pbody .ex').first();
  await expect(fourAuthors).toContainText('Gasparrini');
  await expect(fourAuthors).toContainText('et al.');
  await expect(page.locator('#v-maxAuthors')).toHaveText('3');

  // Raise the limit past the sample's author count: the full list comes back.
  const more = page.locator('[data-step="maxAuthors"][data-d="1"]');
  await more.click();
  await more.click();
  await expect(page.locator('#v-maxAuthors')).toHaveText('5');
  await expect(fourAuthors).toContainText('Hashizume');
  await expect(fourAuthors).not.toContainText('et al.');

  // The CSL override tab mirrors the same rule (et-al-min = maxAuthors + 1).
  await page.locator('#tabCsl').click();
  await expect(page.locator('.code pre')).toContainText('"et-al-min"');
  await expect(page.locator('.code pre')).toContainText('6');

  await page.locator('#seSave').click();

  // Persisted: reopen the editor after a reload.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await page.locator('#sFull').click();
  await expect(page.locator('#v-maxAuthors')).toHaveText('5');

  // Back to the list view restores the app shell.
  await page.locator('#seBack').click();
  await expect(page.locator('#viewTitle')).toHaveText('Citation styles');
  await expect(page.locator('.sidebar')).toBeVisible();

  await page.close();
});

test('Team view invites a member, changes their role, and states that roles are advisory', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.locator('#nav .nav-item[data-route="team"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('Team');

  // Team opens on Activity; members live behind their own tab.
  await page.locator('.vtab[data-tab="members"]').click();

  // The advisory-roles caveat is stated, not implied.
  await expect(page.locator('.advisory')).toContainText('Roles are advisory');

  // The owner is listed and cannot be demoted (last owner keeps the project administrable).
  await expect(page.locator('.mem')).toHaveCount(1);
  await expect(page.locator('.mem .stat-tag')).toHaveText('Owner');

  // Capability matrix: six capabilities × three roles.
  await expect(page.locator('.matrix tbody tr')).toHaveCount(6);

  // Invite an editor.
  await page.locator('#tInvite').click();
  await page.locator('#invEmail').fill('j.park@lab.edu');
  await page.locator('#invRole').selectOption('editor');
  await page.locator('#invGo').click();

  const invited = page.locator('.mem').nth(1);
  await expect(invited).toContainText('j.park');
  await expect(invited.locator('.badge-pend')).toHaveText('Invited');

  // Change their role and reload: the change persisted.
  await invited.locator('select[data-role]').selectOption('viewer');
  await page.reload();
  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="members"]').click();
  await expect(page.locator('.mem').nth(1).locator('select[data-role]')).toHaveValue('viewer');

  // Remove them again, leaving the owner alone.
  await page.locator('.mem').nth(1).locator('[data-rm]').click();
  await expect(page.locator('.mem')).toHaveCount(1);

  await page.close();
});

test('Activity tab shows a status move with a before→after diff and filters by kind', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Two writes through the service worker: the source, then the status move.
  // The feed is recorded there, so nothing in the dashboard has to know.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    const document = {
      id: 'e2e-feed-1',
      projectId,
      url: 'https://example.org/feed',
      type: 'article',
      metadata: { title: 'Feed status move', authors: ['Logger, A.'], year: 2026 },
      status: 'toRead',
      section: 'Literature',
      createdAt: now,
      updatedAt: now,
    };
    await chrome.runtime.sendMessage({ type: 'documents/put', document });
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: { ...document, status: 'inReview' },
    });
  });

  await page.reload();
  await page.locator('#nav .nav-item[data-route="team"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('Team');

  // Activity is the tab the Team view opens on.
  await expect(page.locator('.vtab[data-tab="activity"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.day').first()).toContainText('Today');

  const moved = page.locator('.ev', { hasText: 'moved Feed status move' });
  await expect(moved).toHaveCount(1);
  await expect(moved.locator('.diff .c').first()).toHaveText('To read');
  await expect(moved.locator('.diff .c.to')).toHaveText('In review');

  // Filtering by kind narrows the feed: the move goes, the source stays.
  await page.locator('.fchip[data-af="source"]').click();
  await expect(page.locator('.ev', { hasText: 'moved Feed status move' })).toHaveCount(0);
  await expect(page.locator('.ev', { hasText: 'added Feed status move' })).toHaveCount(1);

  await page.close();
});

test('Discuss on an annotation starts a thread, which replies and resolves in Team → Comments', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // Seed a source and a note to hang the discussion off.
  await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-thread-doc',
        projectId,
        url: 'https://example.org/thread',
        type: 'article',
        metadata: { title: 'Thread source', authors: ['Talker, T.'], year: 2026 },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-thread-anno',
        projectId,
        documentId: 'e2e-thread-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'worth discussing' }] },
        content: 'Needs a second opinion',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  // Start the thread from the annotation card.
  await page.locator('#nav .nav-item[data-route="annotations"]').click();
  await page.locator('.anno[data-id="e2e-thread-anno"] [data-discuss]').click();
  await page.locator('#thBody').fill('Is the sample big enough here?');
  await page.locator('#thGo').click();

  // It is waiting in Team → Comments, anchored to the quoted passage.
  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="comments"]').click();
  const thread = page.locator('.thread').filter({ hasText: 'Is the sample big enough here?' });
  await expect(thread).toHaveCount(1);
  await expect(thread.locator('.anchor')).toContainText('worth discussing');

  // Reply, then resolve: the reply is kept and the thread stops taking input.
  await thread.locator('[data-reply]').fill('Three cities only — add a caveat.');
  await thread.locator('[data-post]').click();
  await expect(page.locator('.thread .cm-txt')).toHaveCount(2);

  await page.locator('.thread [data-res]').first().click();
  await expect(page.locator('.thread.resolved')).toHaveCount(1);
  await expect(page.locator('.thread.resolved [data-reply]')).toHaveCount(0);

  // Reload: the whole thread persisted, and the feed recorded every step.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="comments"]').click();
  await expect(page.locator('.thread .cm-txt')).toHaveCount(2);

  await page.locator('.vtab[data-tab="activity"]').click();
  await expect(page.locator('.ev', { hasText: 'started a thread' })).toHaveCount(1);
  await expect(page.locator('.ev', { hasText: 'resolved a thread' })).toHaveCount(1);

  await page.close();
});

test('Sync tab exports a snapshot file, switches mode, and merges an import by DOI', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="sync"]').click();

  // The local-first scope is stated, not implied: no backend on offer.
  await expect(page.locator('.mode[data-mode="backend"]')).toBeDisabled();
  await expect(page.locator('.mode[data-mode="backend"]')).toContainText('Unavailable');

  // Switching mode persists on the project record.
  await page.locator('.mode[data-mode="file"]').click();
  await expect(page.locator('.mode[data-mode="file"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="sync"]').click();
  await expect(page.locator('.mode[data-mode="file"]')).toHaveAttribute('aria-pressed', 'true');

  // Export downloads a real file, named after the project.
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#expGo').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^my-research-project-\d{4}-\d{2}-\d{2}\.json$/);

  // Choosing a file previews the merge instead of performing it.
  const built = await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-plan-doc',
        projectId,
        url: 'https://example.org/plan',
        type: 'article',
        metadata: { title: 'Plan preview source' },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    const exported = await chrome.runtime.sendMessage({ type: 'snapshot/export', projectId });
    const envelope = JSON.parse(exported.data.content);
    // A source only the file has, so the plan has something to promise.
    envelope.payload.documents.push({
      ...envelope.payload.documents[0],
      id: 'only-in-the-file',
      metadata: { title: 'Only in the file' },
    });
    return JSON.stringify(envelope);
  });

  const planChooser = page.waitForEvent('filechooser');
  await page.locator('#impGo').click();
  await (
    await planChooser
  ).setFiles({
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(built),
  });

  // The plan says what would happen, and nothing has been written yet.
  await expect(page.locator('.plan')).toContainText('Merge into');
  await expect(page.locator('.plan-list')).toContainText('Sources');
  await expect(page.locator('.plan-list')).toContainText('your copy is newer');
  expect(
    await page.evaluate(async () => {
      const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
      const docs = await chrome.runtime.sendMessage({
        type: 'documents/listByProject',
        projectId: projects.data[0].id,
      });
      return docs.data.some((d: { id: string }) => d.id === 'only-in-the-file');
    }),
  ).toBe(false);

  // Cancelling leaves it that way; confirming performs the merge.
  await page.locator('#impCancel').click();
  await expect(page.locator('.plan')).toHaveCount(0);

  const confirmChooser = page.waitForEvent('filechooser');
  await page.locator('#impGo').click();
  await (
    await confirmChooser
  ).setFiles({
    name: 'plan.json',
    mimeType: 'application/json',
    buffer: Buffer.from(built),
  });
  await page.locator('#impConfirm').click();
  await expect(page.locator('.plan')).toHaveCount(0);
  await page.locator('#nav .nav-item[data-route="documents"]').click();
  await expect(page.locator('.tbl tbody tr', { hasText: 'Only in the file' })).toHaveCount(1);

  await page.locator('#nav .nav-item[data-route="team"]').click();
  await page.locator('.vtab[data-tab="sync"]').click();

  // Import the same project back, with one source deduped by DOI: the snapshot
  // carries a second copy of a DOI the project already has under another id.
  const report = await page.evaluate(async () => {
    const projects = await chrome.runtime.sendMessage({ type: 'projects/list' });
    const projectId = projects.data[0].id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-sync-doi',
        projectId,
        url: 'https://example.org/sync',
        type: 'article',
        metadata: { title: 'Sync DOI source', doi: '10.1000/sync-e2e' },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    const exported = await chrome.runtime.sendMessage({ type: 'snapshot/export', projectId });
    const envelope = JSON.parse(exported.data.content);
    // Same DOI, different id — exactly what a collaborator's file looks like.
    envelope.payload.documents = envelope.payload.documents.map((d: { id: string }) =>
      d.id === 'e2e-sync-doi' ? { ...d, id: 'from-a-colleague' } : d,
    );
    const imported = await chrome.runtime.sendMessage({
      type: 'snapshot/import',
      content: JSON.stringify(envelope),
    });
    return imported.data as { dedupedByDoi: number };
  });
  expect(report.dedupedByDoi).toBeGreaterThan(0);

  // The duplicate never landed: one row for that DOI, not two.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="documents"]').click();
  await expect(page.locator('.tbl tbody tr', { hasText: 'Sync DOI source' })).toHaveCount(1);

  await page.close();
});

test('Style editor imports a third-party .csl and formats the preview through it', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await page.locator('.style-card').first().click();
  await page.locator('#sFull').click();
  await expect(page.locator('.sed')).toBeVisible();

  // A minimal but real CSL style, chosen so its output is unmistakable.
  const csl = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>E2E House Style</title><id>http://example.org/e2e</id>
    <category citation-format="author-date"/></info>
  <macro name="author"><names variable="author"><name form="short"/></names></macro>
  <citation><layout prefix="(" suffix=")"><text macro="author"/></layout></citation>
  <bibliography><layout><text value="HOUSE:"/><text macro="author" prefix=" "/></layout></bibliography>
</style>`;

  const chooser = page.waitForEvent('filechooser');
  await page.locator('#sedImport').click();
  await (
    await chooser
  ).setFiles({
    name: 'house.csl',
    mimeType: 'application/xml',
    buffer: Buffer.from(csl),
  });

  // The imported style is selected, named from the file, and grouped apart.
  const base = page.locator('#sedBase');
  await expect(base).toHaveValue('custom-base:e2e-house-style');
  await expect(page.locator('#sedBase optgroup[label="Imported"] option')).toContainText(
    'E2E House Style',
  );

  // The live preview is real citeproc output through the imported file.
  await expect(page.locator('#sedPanel')).toContainText('HOUSE:', { timeout: 10_000 });

  // It survives a reload — the style lives in IndexedDB, not in the page.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="styles"]').click();
  await page.locator('.style-card').first().click();
  await page.locator('#sFull').click();
  await expect(page.locator('#sedBase')).toHaveValue('custom-base:e2e-house-style');

  // Forgetting it leaves the profile alone and says the base style is missing.
  await page.locator('#sedDropBase').click();
  await expect(page.locator('#sedBase option[value="custom-base:e2e-house-style"]')).toContainText(
    'missing',
  );

  await page.close();
});

test('a hostile snapshot is refused, and nothing it carried reaches the page', async () => {
  const page = await context.newPage();
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  // A snapshot such as a collaborator might send. The id is the payload: it
  // closes the `data-id` attribute and opens an element of the attacker's
  // choosing, which then calls home.
  const outcome = await page.evaluate(async () => {
    const send = (m: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> =>
      chrome.runtime.sendMessage(m);
    const projects = await send({ type: 'projects/list' });
    const projectId = (projects.data as Array<{ id: string }>)[0]!.id;
    const exported = await send({ type: 'snapshot/export', projectId });
    const envelope = JSON.parse((exported.data as { content: string }).content);
    const now = new Date().toISOString();
    envelope.payload.documents.push({
      id: 'x"><img src="https://example.invalid/beacon.png" id="pwned"><b data-z="',
      projectId,
      url: 'https://example.org/x',
      type: 'article',
      metadata: { title: 'Looks like an ordinary source' },
      status: 'toRead',
      createdAt: now,
      updatedAt: now,
    });
    const preview = await send({ type: 'snapshot/preview', content: JSON.stringify(envelope) });
    const imported = await send({ type: 'snapshot/import', content: JSON.stringify(envelope) });
    return { preview, imported };
  });

  // Both halves fail closed, and the message names what is wrong.
  expect(outcome.preview.ok).toBe(false);
  expect(outcome.imported.ok).toBe(false);
  expect(outcome.imported.error).toMatch(/is not a usable id/);

  // Nothing was written, nothing was injected, and the page called nobody.
  await page.reload();
  await page.locator('#nav .nav-item[data-route="documents"]').click();
  await expect(page.locator('#pwned')).toHaveCount(0);
  await expect(
    page.locator('.tbl tbody tr', { hasText: 'Looks like an ordinary source' }),
  ).toHaveCount(0);
  expect(requested.filter((u) => u.includes('example.invalid'))).toEqual([]);

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

test('the colour legend lives in Settings, previews itself, filters, and guards used colours', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');
  await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    await chrome.runtime.sendMessage({
      type: 'web/annotate',
      input: {
        projectId: projects.data[0]!.id,
        url: 'https://example.org/legend-e2e',
        type: 'webPage',
        metadata: { title: 'Legend under test' },
      },
      anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'a passage' }] },
      color: 'green',
    });
  });
  await page.reload();

  // Discoverable in the nav, not hidden behind a button in one view.
  await page.locator('#nav .nav-item[data-route="settings"]').click();
  await expect(page.locator('#viewTitle')).toHaveText('Settings');
  await expect(page.locator('#setPalette .palette-row')).toHaveCount(4);
  // Each row shows the colour as it will actually look on a page.
  await expect(
    page.locator('#setPalette .palette-row').first().locator('.palette-preview span'),
  ).toBeVisible();

  // A colour in use cannot be deleted out from under its highlights.
  const greenRow = page.locator('#setPalette .palette-row').nth(1);
  await expect(greenRow.locator('.palette-use')).toHaveText('1 highlight');
  await expect(greenRow.locator('[data-del]')).toBeDisabled();
  await expect(page.locator('#setPalette .palette-row').nth(2).locator('[data-del]')).toBeEnabled();

  // Name it, recolour it, add one, save.
  await page.locator('[data-lb="1"]').fill('Method');
  await greenRow.locator('.swatch').nth(4).click();
  await page.locator('#palAdd').click();
  await expect(page.locator('#setPalette .palette-row')).toHaveCount(5);
  await page.locator('[data-lb="4"]').fill('Disagree');
  await page.locator('#palSave').click();
  await expect(page.locator('#palSave')).toBeDisabled(); // saved → nothing pending

  // The legend now filters the annotations list.
  await page.locator('#nav .nav-item[data-route="annotations"]').click();
  await expect(page.locator('.legend-chip')).toHaveCount(6); // All + 5
  await expect(page.locator('.legend-chip', { hasText: 'Method' })).toContainText('1');
  await page.locator('.legend-chip', { hasText: 'Disagree' }).click();
  await expect(page.locator('.anno')).toHaveCount(0); // nothing is "Disagree" yet
  await page.locator('.legend-chip', { hasText: 'Method' }).click();
  await expect(page.locator('.anno')).toHaveCount(1);

  // And the legend travels: palette/get is what the annotator paints from.
  const labels = await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const res = (await chrome.runtime.sendMessage({
      type: 'palette/get',
      projectId: projects.data[0]!.id,
    })) as { data: Array<{ label: string }> };
    return res.data.map((c) => c.label);
  });
  expect(labels).toEqual(['Yellow', 'Method', 'Blue', 'Pink', 'Disagree']);
  await page.close();
});

test('a source row opens its page, and an annotation card offers to show the highlight', async () => {
  const page = await context.newPage();
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');

  await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const projectId = projects.data[0]!.id;
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'documents/put',
      document: {
        id: 'e2e-nav-doc',
        projectId,
        url: 'https://example.org/e2e-nav',
        type: 'article',
        metadata: { title: 'Navigable source' },
        status: 'toRead',
        createdAt: now,
        updatedAt: now,
      },
    });
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: {
        id: 'e2e-nav-anno',
        projectId,
        documentId: 'e2e-nav-doc',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'a passage' }] },
        color: 'green',
        content: 'jump target',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
  });
  await page.reload();

  // Clicking the row opens the source — previously only a small icon did.
  await page.locator('#nav .nav-item[data-route="documents"]').click();
  const row = page.locator('.tbl tbody tr[data-id="e2e-nav-doc"]');
  await expect(row).toHaveClass(/row-open/);
  const openedPromise = context.waitForEvent('page');
  await row.locator('.ttl').click();
  const opened = await openedPromise;
  expect(opened.url()).toBe('https://example.org/e2e-nav');
  await opened.close();

  // Clicking the annotation card asks the worker to open its page and scroll
  // to the highlight; the request is parked for the annotator to collect.
  await page.locator('#nav .nav-item[data-route="annotations"]').click();
  const card = page.locator('.anno[data-id="e2e-nav-anno"]');
  await expect(card).toHaveClass(/anno--clickable/);
  const jumpPagePromise = context.waitForEvent('page');
  await card.locator('.anno-body').click();
  const jumpPage = await jumpPagePromise;
  expect(jumpPage.url()).toBe('https://example.org/e2e-nav');
  await jumpPage.close();
  await page.close();
});

test('every source row offers both citation forms, named', async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (t: string) => {
          (window as unknown as { __copied: string[] }).__copied.push(t);
        },
      },
      configurable: true,
    });
  });
  await page.goto(dashboardUrl());
  await expect(page.locator('#pName')).not.toHaveText('—');
  await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const now = new Date().toISOString();
    await chrome.runtime.sendMessage({
      type: 'capture/page',
      input: {
        projectId: projects.data[0]!.id,
        url: 'https://example.org/citable-source',
        type: 'article',
        metadata: {
          title: 'A citable source',
          authors: ['Oke, T. R.'],
          year: 1982,
          journal: 'QJRMS',
        },
      },
    });
    void now;
  });
  await page.reload();
  await page.locator('#nav .nav-item[data-route="documents"]').click();

  const row = page.locator('.tbl tbody tr', { hasText: 'A citable source' });
  await row.locator('[data-cite-doc]').click();
  // Both forms are offered BY NAME — a single unlabelled button was the
  // reason people could not find how to copy a citation at all.
  await expect(page.locator('#pop [data-form="inText"]')).toBeVisible();
  await expect(page.locator('#pop [data-form="bibliography"]')).toBeVisible();

  await page.locator('#pop [data-form="inText"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1)))
    .toContain('Oke');

  await row.locator('[data-cite-doc]').click();
  await page.locator('#pop [data-form="bibliography"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied.at(-1)))
    .toContain('A citable source');
  await page.close();
});
