/**
 * Retake `doc/screenshots/` from a real build.
 *
 * Loads `dist/` into a headed Chromium, seeds a project through the extension's
 * own messaging layer — so the data travels the same path a user's would — and
 * walks every surface. Run it after any change that alters how the app looks:
 *
 *   npm run build && npm run screenshots
 *
 * Kept in the repo because the screenshots have already needed retaking twice
 * (an icon-sizing fix, then bundled fonts), and rebuilding this from scratch
 * each time costs more than the file does. The seed data is deliberately
 * plausible research rather than "test 1 / test 2": screenshots are what people
 * see before they install anything.
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = `${ROOT}dist`;
const OUT = `${ROOT}doc/screenshots`;

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

const pdfBase64 = readFileSync(`${ROOT}e2e/fixtures/sample.pdf`).toString('base64');

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox'],
  viewport: { width: 1360, height: 940 },
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const url = (path) => `chrome-extension://${extensionId}/${path}`;

const page = await context.newPage();
await page.goto(url('src/options/index.html'));
await page.waitForTimeout(700);

await page.evaluate(async (pdf) => {
  const send = (message) => chrome.runtime.sendMessage(message);
  const projects = await send({ type: 'projects/list' });
  const project = projects.data[0];
  const projectId = project.id;
  const iso = (daysAgo, hour = 10) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  await send({
    type: 'projects/put',
    project: {
      ...project,
      name: 'Urban Heat & Mortality',
      description: 'Investigation',
      sections: ['Literature', 'Methods', 'Data', 'Report'],
    },
  });

  const sources = [
    [
      'd-oke',
      'The energetic basis of the urban heat island',
      ['Oke, T. R.'],
      1982,
      'Quarterly Journal of the Royal Meteorological Society',
      '10.1002/qj.49710845502',
      'usedInOutput',
      'Literature',
    ],
    [
      'd-gasp',
      'Mortality risk attributable to high and low ambient temperature',
      ['Gasparrini, A.', 'Guo, Y.', 'Hashizume, M.'],
      2015,
      'The Lancet',
      '10.1016/S0140-6736(14)62114-0',
      'analysed',
      'Literature',
    ],
    [
      'd-stone',
      'Urban form and extreme heat events',
      ['Stone, B.', 'Hess, J. J.', 'Frumkin, H.'],
      2010,
      'Environmental Health Perspectives',
      '10.1289/ehp.0901879',
      'analysed',
      'Methods',
    ],
    [
      'd-heaviside',
      'The effects of horticultural cooling on heat-related mortality',
      ['Heaviside, C.', 'Vardoulakis, S.'],
      2016,
      'Environmental Health',
      '10.1186/s12940-016-0100-9',
      'inReview',
      'Data',
    ],
    [
      'd-defra',
      'Air quality and urban temperature monitoring dataset',
      ['DEFRA'],
      2024,
      'UK Air Information Resource',
      '',
      'inReview',
      'Data',
    ],
    [
      'd-foi',
      'FOI response: council cooling-centre provision 2019–2024',
      ['Manchester City Council'],
      2025,
      '',
      '',
      'toRead',
      'Report',
    ],
  ];
  for (const [id, title, authors, year, journal, doi, status, section] of sources) {
    await send({
      type: 'documents/put',
      document: {
        id,
        projectId,
        url: `https://example.org/${id}`,
        type: doi ? 'article' : 'report',
        metadata: {
          title,
          authors,
          year,
          ...(journal ? { journal } : {}),
          ...(doi ? { doi } : {}),
        },
        status,
        section,
        createdAt: iso(9),
        updatedAt: iso(1),
      },
    });
  }

  await send({
    type: 'files/put',
    file: { id: 'f-sample', name: 'gasparrini-2015.pdf', mime: 'application/pdf', dataBase64: pdf },
  });
  await send({
    type: 'documents/put',
    document: {
      id: 'd-pdf',
      projectId,
      url: 'file://gasparrini-2015.pdf',
      fileId: 'f-sample',
      type: 'pdf',
      metadata: { title: 'Gasparrini et al. 2015 (PDF)', authors: ['Gasparrini, A.'], year: 2015 },
      status: 'inReview',
      section: 'Literature',
      createdAt: iso(3),
      updatedAt: iso(1),
    },
  });

  const notes = [
    [
      'a1',
      'd-oke',
      'Nocturnal UHI intensity above roughly four degrees is where the mortality signal starts to separate.',
      ['uhi', 'mechanism'],
      'includedInReport',
      'the energetic basis of the urban heat island',
    ],
    [
      'a2',
      'd-gasp',
      'Lag structure matters: cold-related deaths dominate the total, which cuts against the headline framing.',
      ['lag', 'method'],
      'accepted',
      'attributable to high and low ambient temperature',
    ],
    [
      'a3',
      'd-stone',
      'Sprawl index is derived from 2000 census tracts — check whether it survives the 2020 boundary changes.',
      ['caveat'],
      'draft',
      'urban form and extreme heat',
    ],
    [
      'a4',
      'd-heaviside',
      'Green-infrastructure scenario assumes uniform canopy gain; unrealistic for dense terraces.',
      ['caveat', 'model'],
      'draft',
      'horticultural cooling',
    ],
    [
      'a5',
      'd-oke',
      'Worth quoting verbatim in the methods section.',
      ['quote'],
      'accepted',
      'energetic basis',
    ],
  ];
  for (const [id, documentId, content, tags, status, exact] of notes) {
    await send({
      type: 'annotations/put',
      annotation: {
        id,
        projectId,
        documentId,
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact }] },
        content,
        tags,
        status,
        author: 'me',
        createdAt: iso(5),
        updatedAt: iso(2),
      },
    });
  }
  await send({
    type: 'annotations/put',
    annotation: {
      id: 'a-pdf',
      projectId,
      documentId: 'd-pdf',
      anchor: {
        kind: 'pdf',
        selectors: [
          {
            type: 'pdfRegion',
            page: 1,
            rects: [{ page: 1, left: 0.12, top: 0.18, width: 0.62, height: 0.06 }],
            quote: 'Mortality risk attributable to temperature',
          },
        ],
      },
      content: 'Panel composition by geographic band — check the >6 °C row.',
      tags: ['figure'],
      status: 'draft',
      author: 'me',
      createdAt: iso(2),
      updatedAt: iso(1),
    },
  });

  const references = [
    [
      'r-oke',
      'd-oke',
      'The energetic basis of the urban heat island',
      [{ family: 'Oke', given: 'T. R.' }],
      1982,
      'Quarterly Journal of the Royal Meteorological Society',
      '10.1002/qj.49710845502',
      '108',
      '455',
      '1-24',
    ],
    [
      'r-gasp',
      'd-gasp',
      'Mortality risk attributable to high and low ambient temperature',
      [
        { family: 'Gasparrini', given: 'A.' },
        { family: 'Guo', given: 'Y.' },
      ],
      2015,
      'The Lancet',
      '10.1016/S0140-6736(14)62114-0',
      '386',
      '9991',
      '369-375',
    ],
    [
      'r-stone',
      'd-stone',
      'Urban form and extreme heat events',
      [
        { family: 'Stone', given: 'B.' },
        { family: 'Hess', given: 'J. J.' },
      ],
      2010,
      'Environmental Health Perspectives',
      '10.1289/ehp.0901879',
      '118',
      '10',
      '1425-1428',
    ],
  ];
  for (const [
    id,
    documentId,
    title,
    author,
    year,
    journal,
    DOI,
    volume,
    issue,
    page,
  ] of references) {
    await send({
      type: 'references/put',
      reference: {
        id,
        projectId,
        documentId,
        cslData: {
          type: 'article-journal',
          title,
          author,
          issued: { 'date-parts': [[year]] },
          'container-title': journal,
          DOI,
          volume,
          issue,
          page,
        },
        source: 'extractedFromPage',
        usedInOutputs: [],
        createdAt: iso(6),
        updatedAt: iso(6),
      },
    });
  }

  await send({
    type: 'users/put',
    user: { id: 'me', name: 'Tomasz Lewandowski', rolesPerProject: { [projectId]: 'owner' } },
  });
  await send({ type: 'members/invite', projectId, email: 'l.reyes@lab.edu', role: 'editor' });
  await send({ type: 'members/invite', projectId, email: 'j.park@lab.edu', role: 'viewer' });

  const thread = await send({
    type: 'comments/start',
    input: {
      projectId,
      annotationId: 'a-pdf',
      anchorLabel: 'p. 1 · Figure 1',
      body: 'The >6 °C band only has three basin cities — worth a caveat in the caption?',
    },
  });
  await send({
    type: 'comments/reply',
    threadId: thread.data.id,
    body: 'Agreed. I added it to the caption and linked §Data.',
  });
  const resolved = await send({
    type: 'comments/start',
    input: {
      projectId,
      documentId: 'd-stone',
      anchorLabel: '“urban form and extreme heat”',
      body: 'Population threshold for inclusion confirmed at 500k.',
    },
  });
  await send({ type: 'comments/setResolved', threadId: resolved.data.id, resolved: true });

  // A couple of moves, so the activity feed has before→after diffs to show.
  const move = async (id, status) => {
    const document = (await send({ type: 'documents/get', id })).data;
    await send({
      type: 'documents/put',
      document: { ...document, status, updatedAt: new Date().toISOString() },
    });
  };
  await move('d-stone', 'analysed');
  await move('d-defra', 'inReview');
  const members = (await send({ type: 'members/list', projectId })).data;
  await send({
    type: 'members/setRole',
    projectId,
    userId: members.find((m) => m.email === 'l.reyes@lab.edu').userId,
    role: 'viewer',
  });
}, pdfBase64);

await page.reload();
await page.waitForTimeout(1000);

const shot = async (target, name) => {
  await target.waitForTimeout(500);
  await target.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot:', name);
};

await shot(page, '01-overview');
for (const [route, name] of [
  ['documents', '02-documents'],
  ['annotations', '03-annotations'],
  ['references', '04-references'],
  ['styles', '05-citation-styles'],
]) {
  await page.locator(`#nav .nav-item[data-route="${route}"]`).click();
  await shot(page, name);
}

await page.locator('.style-card').first().click();
await page.locator('#sFull').click();
await page.waitForTimeout(1500); // the live preview formats through real citeproc
await shot(page, '06-style-editor');
await page.locator('#tabCsl').click();
await shot(page, '07-style-editor-csl');

await page.goto(url('src/options/index.html'));
await page.waitForTimeout(900);
await page.locator('#nav .nav-item[data-route="team"]').click();
await page.waitForTimeout(600);
await shot(page, '08-team-activity');
for (const [tab, name] of [
  ['comments', '09-team-comments'],
  ['members', '10-team-members'],
  ['sync', '11-team-sync'],
]) {
  await page.locator(`.vtab[data-tab="${tab}"]`).click();
  await shot(page, name);
}

const panel = await context.newPage();
await panel.setViewportSize({ width: 400, height: 820 });
await panel.goto(url('src/sidepanel/index.html'));
await panel.waitForTimeout(1300);
await shot(panel, '12-side-panel');
await panel.locator('[data-od-id="status-d-stone"]').click();
await shot(panel, '13-side-panel-status-menu');
await panel.close();

const reader = await context.newPage();
await reader.setViewportSize({ width: 1360, height: 940 });
await reader.goto(url('src/pdfviewer/index.html?documentId=d-pdf'));
await reader.waitForTimeout(2500); // pdf.js renders the page to canvas
await shot(reader, '14-pdf-reader');
await reader.close();

await context.close();
console.log(`\nWrote 14 screenshots to ${OUT}`);
