import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Locator,
  type Worker,
  type Page,
} from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * E2E for the web-annotation loop: highlight a sentence, prove the overlay
 * paints in the annotator's shadow root, and prove it repaints from the
 * stored anchor after a reload — the persistence guarantee that matters.
 *
 * Activation path: production activates the annotator via
 * `chrome.scripting.executeScript` triggered by the side panel's "Annotate
 * this page" button, relying on `activeTab`. That grant is tied to a real
 * browser-action/side-panel gesture Playwright has no handle for (there is no
 * on-page element for the toolbar icon), and the alternative —
 * `chrome.permissions.request` for a host pattern — blocks forever on a
 * native Chrome consent bubble that never surfaces as a Playwright-visible
 * page (verified empirically: both were tried and left `.ov` unpainted /
 * the request promise permanently pending). So this spec instead loads the
 * fixture as an extension-origin page (`chrome-extension://<id>/...`, copied
 * from `e2e/fixtures/article.html` into `dist/` for the duration of the
 * run) and injects the real built `dist/annotator.js` via
 * `page.addScriptTag`. Extension-origin pages get the full `chrome.*` API
 * with no host-permission gate — the same reason the existing sidepanel /
 * options / pdfviewer specs never hit this wall — so the annotator's actual
 * production code runs unmodified: real DOM anchoring
 * (`dom-anchor-text-quote`), the real shadow-root overlay math, and the real
 * `web/annotate` / `web/annotationsForUrl` round trip through the router.
 * Part (f) (persistence) is asserted via that same messaging round trip
 * rather than the side panel's "Notes on this page" list: that list is
 * gated to `/^https?:/` URLs (`src/sidepanel/main.ts` `isCapturablePreview`)
 * and an extension-origin fixture URL would never satisfy it regardless of
 * how the annotator itself was activated.
 */

const distPath = fileURLToPath(new URL('../dist', import.meta.url));
const fixtureSrc = fileURLToPath(new URL('./fixtures/article.html', import.meta.url));
const fixtureDest = path.join(distPath, 'e2e-article.html');
/** A page taller than any viewport — the only way to prove a jump SCROLLED.
 *  The short fixture cannot scroll at all, which silently passed a jump that
 *  did nothing (overlays live in a fixed layer, so scrollIntoView on one is a
 *  no-op — the bug this fixture exists to catch). */
const tallDest = path.join(distPath, 'e2e-tall-article.html');
const TALL_TARGET = 'The urban heat island effect raises night-time temperatures.';
function tallArticleHtml(): string {
  const filler = Array.from(
    { length: 60 },
    (_, i) => `<p>Paragraph ${i + 1}: cities absorb and re-radiate heat through the night.</p>`,
  ).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tall</title>
    <style>body{font:16px/1.7 system-ui;max-width:720px;margin:0 auto;padding:24px}</style>
    </head><body><h1>Tall article</h1>${filler}
    <p id="target">${TALL_TARGET}</p>${filler}</body></html>`;
}
const targetSentence = 'The urban heat island effect raises night-time temperatures.';

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  // Only reachable as a `chrome-extension://` page for the duration of this
  // spec — not part of the Vite build, not committed, cleaned up in afterAll.
  copyFileSync(fixtureSrc, fixtureDest);
  copyFileSync(
    fileURLToPath(new URL('./fixtures/shadow-article.html', import.meta.url)),
    path.join(distPath, 'shadow-article.html'),
  );
  writeFileSync(tallDest, tallArticleHtml());

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
  rmSync(fixtureDest, { force: true });
  rmSync(path.join(distPath, 'shadow-article.html'), { force: true });
  rmSync(tallDest, { force: true });
});

function fixtureUrl(): string {
  return `chrome-extension://${extensionId}/e2e-article.html`;
}

function annotatorUrl(): string {
  return `chrome-extension://${extensionId}/annotator.js`;
}

/** Select the target sentence and fire the mouseup the annotator listens for. */
async function selectTargetSentence(page: Page): Promise<void> {
  await page.locator('p', { hasText: targetSentence }).selectText();
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
}

/**
 * The overlay's laid-out rect, waited for rather than sampled once.
 *
 * `commit()` is asynchronous — it awaits the active project and the
 * `web/annotate` round trip before painting — so the click returns with no
 * overlay in the shadow root at all; measured per animation frame, the first
 * `.ov` appears about 18 ms later. `toHaveCount(1)` bridges that, but it
 * resolves the instant the node is appended, which is one frame before the
 * element has a box: read straight after it, the geometry comes back as `null`
 * from `boundingBox()` (CDP's box model) or as zeros from
 * `getBoundingClientRect()`. That is why this test failed every time it ran on
 * its own and passed inside a full suite, where the preceding specs left the
 * renderer warm enough for layout to win the race.
 *
 * So poll the assertion itself until the box is real. Not a sleep: if the
 * overlay genuinely never gets a box — the regression these assertions exist
 * for — the poll exhausts its timeout and the test fails.
 */
async function paintedRect(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let rect = { x: 0, y: 0, width: 0, height: 0 };
  await expect
    .poll(async () => {
      rect = await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return rect.width;
    })
    .toBeGreaterThan(1);
  return rect;
}

test('a selection made BEFORE activation shows the toolbar at injection time', async () => {
  // The natural order in the field: the user selects the passage first, THEN
  // presses "Annotate this page". The annotator used to arm only on the next
  // mouseup, so the deliberate selection read as "it doesn't work".
  const page = await context.newPage();
  await page.goto(fixtureUrl());
  await page.locator('p', { hasText: targetSentence }).selectText();

  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  // Nothing was committed — closing the page leaves storage untouched for
  // the specs that follow.
  await page.close();
});

test('highlighting a selection paints an overlay that repaints after reload, and persists', async () => {
  const page = await context.newPage();
  await page.goto(fixtureUrl());
  await expect(
    page.locator('main[style*="position: relative"] p', { hasText: targetSentence }),
  ).toBeVisible();

  // Activate: inject the real built annotator script (see file-header comment
  // for why this replaces the side-panel/executeScript path in this harness).
  // No `type: 'module'` — the build now compiles annotator.js as a
  // self-contained IIFE (vite.annotator.config.ts), not an ES module, so it
  // must run as a classic script the same way production's
  // `chrome.scripting.executeScript({ files: ['annotator.js'] })` does.
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator')).toHaveCount(1);

  await selectTargetSentence(page);
  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();

  // The dots must actually SHOW their colours — a higher-specificity
  // `.toolbar button { background: none }` once painted all four as black
  // holes in the dark toolbar, and only a human noticed.
  const yellowBg = await page
    .locator('#context-notes-annotator .toolbar button[data-color="yellow"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(yellowBg).toBe('rgb(250, 204, 21)');

  // The selection's own client rect — the ground truth the overlay must
  // match. Captured before commit() clears the selection.
  const expectedRect = await page.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0).getClientRects()[0];
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  });
  expect(expectedRect).not.toBeNull();

  await page.locator('#context-notes-annotator .toolbar button[data-color="green"]').click();

  // The overlay exists in the shadow root, and lines up with the selection —
  // the regression a `position: fixed` overlay layer (immune to the
  // `position: relative` <main> ancestor above) guards against.
  const overlay = page.locator('#context-notes-annotator .ov');
  await expect(overlay).toHaveCount(1);
  // The chosen colour paints immediately — attribute for identity, computed
  // style for VISIBILITY (a specificity clash once shipped black dots).
  await expect(overlay).toHaveAttribute('data-color', 'green');
  const paintedBg = await overlay.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(paintedBg).toContain('74, 222, 128');
  const ovBox = await paintedRect(overlay);
  if (expectedRect) {
    expect(Math.abs(ovBox.x - expectedRect.left)).toBeLessThan(2);
    expect(Math.abs(ovBox.y - expectedRect.top)).toBeLessThan(2);
    expect(Math.abs(ovBox.width - expectedRect.width)).toBeLessThan(2);
  }
  // Toolbar is dismissed once the highlight commits.
  await expect(page.locator('#context-notes-annotator .toolbar')).toHaveCount(0);

  // -- Reload: the anchor must resolve from storage and repaint on its own. --
  await page.reload();
  await page.addScriptTag({ url: annotatorUrl() });

  const overlayAfterReload = page.locator('#context-notes-annotator .ov');
  await expect(overlayAfterReload).toHaveCount(1);
  // …and is stored, not cosmetic: the repaint from storage keeps it.
  await expect(overlayAfterReload).toHaveAttribute('data-color', 'green');
  const ovBoxAfterReload = await paintedRect(overlayAfterReload);
  if (expectedRect) {
    expect(Math.abs(ovBoxAfterReload.x - expectedRect.left)).toBeLessThan(2);
    expect(Math.abs(ovBoxAfterReload.y - expectedRect.top)).toBeLessThan(2);
  }

  // -- Persistence, asserted via the same message the annotator itself uses
  // to repaint (`web/annotationsForUrl`) — see file-header comment on why
  // this stands in for the side panel's "Notes on this page" list here. --
  const stored = await page.evaluate(async () => {
    const res = (await chrome.runtime.sendMessage({
      type: 'web/annotationsForUrl',
      projectId: '',
      url: location.href,
    })) as {
      ok: true;
      data: {
        annotations: Array<{ anchor: { selectors: Array<{ type: string; exact?: string }> } }>;
      };
    };
    return res;
  });
  expect(stored.ok).toBe(true);
  expect(stored.data.annotations).toHaveLength(1);
  const quoteSelector = stored.data.annotations[0]?.anchor.selectors.find(
    (s) => s.type === 'textQuote',
  );
  expect(quoteSelector?.exact).toBe(targetSentence);

  await page.close();
});

test('a failed annotate dismisses the toolbar and paints nothing, without hanging', async () => {
  // A distinct query string → a fresh URL with no annotations stored by the
  // test above, so the overlay assertions start from a clean slate.
  const page = await context.newPage();
  await page.goto(`${fixtureUrl()}?case=fail`);
  await expect(page.locator('p', { hasText: targetSentence })).toBeVisible();
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator')).toHaveCount(1);

  // Simulate the service worker asleep / the extension context invalidated: the
  // annotate round trip rejects. Every other control message still passes
  // through, so activation and repaint are unaffected.
  await page.evaluate(() => {
    const runtime = chrome.runtime as unknown as {
      sendMessage: (m: unknown, ...r: unknown[]) => Promise<unknown>;
    };
    const orig = runtime.sendMessage.bind(chrome.runtime);
    runtime.sendMessage = (m: unknown, ...r: unknown[]) =>
      (m as { type?: string })?.type === 'web/annotate'
        ? Promise.reject(new Error('simulated: service worker asleep'))
        : orig(m, ...r);
  });

  await selectTargetSentence(page);
  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button[data-color="yellow"]').click();

  // The commit's send rejected — but `commit()` must catch it: the toolbar is
  // dismissed (not left stuck over the selection) and nothing is painted. Before
  // the fix this rejected unhandled and left the toolbar open.
  await expect(page.locator('#context-notes-annotator .toolbar')).toHaveCount(0);

  // …and it must STAY dismissed. The document's mouseup handler is deferred by
  // `setTimeout(…, 0)`, while a fast rejection resolves in microtasks, so the
  // click's own mouseup used to land *after* the dismissal and re-open the
  // toolbar over the still-present selection — permanently. Draining two
  // macrotask turns guarantees that handler has run, whichever order the two
  // raced in, which is what makes this deterministic instead of a coin flip.
  await page.evaluate(() => new Promise((r) => setTimeout(() => setTimeout(r, 0), 0)));
  await expect(page.locator('#context-notes-annotator .toolbar')).toHaveCount(0);
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(0);
  await page.close();
});

test('re-anchors across a client-side (SPA) navigation', async () => {
  const page = await context.newPage();
  await page.goto(`${fixtureUrl()}?spa=1`);
  await expect(page.locator('p', { hasText: targetSentence })).toBeVisible();
  await page.addScriptTag({ url: annotatorUrl() });

  // Highlight on ?spa=1 → one overlay, stored under this URL.
  await selectTargetSentence(page);
  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button[data-color="yellow"]').click();
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);

  // SPA-navigate to ?spa=2 (no annotations). pushState is invisible to a
  // content script, so the page dispatches popstate the way the watcher's
  // catch-all poll would eventually see — the stale overlay must clear.
  await page.evaluate(() => {
    history.pushState({}, '', '?spa=2');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(0);

  // Navigate back to ?spa=1 — the annotation for that URL re-anchors on its own.
  await page.evaluate(() => {
    history.pushState({}, '', '?spa=1');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);
  await page.close();
});

/**
 * Attaches the open shadow root the fixture describes. Not inlined as a
 * <script> in shadow-article.html: extension-origin pages run under MV3's
 * default `script-src 'self'` CSP, which silently blocks inline script
 * execution (verified empirically — an inline attachShadow() call there
 * never ran, leaving the host's `shadowRoot` null). `page.evaluate` runs
 * through CDP and is not subject to the page's CSP, so it stands in for the
 * fixture's own setup — the same class of harness adaptation this file's
 * header comment already documents for activation.
 */
async function attachShadowSentence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const host = document.getElementById('host') as HTMLElement;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<p style="font: 16px/1.5 system-ui">Photosynthesis converts sunlight into chemical energy.</p>';
  });
}

test('anchors a selection made inside an open shadow root, and repaints after reload', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/shadow-article.html`);
  await attachShadowSentence(page);
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator')).toHaveCount(1);

  // Select the shadow-tree sentence and fire the mouseup FROM the shadow node,
  // composed:true, so the annotator's document listener sees the ShadowRoot in
  // composedPath() — exactly what a real user mouseup carries.
  await page.evaluate(() => {
    const root = (document.getElementById('host') as HTMLElement).shadowRoot!;
    const p = root.querySelector('p')!;
    // ShadowRoot.getSelection is a non-standard Chrome extension of the DOM
    // (not in TS's lib.dom.d.ts) — cast rather than weaken the fallback.
    const shadowRootWithSelection = root as ShadowRoot & { getSelection?: () => Selection | null };
    const sel = shadowRootWithSelection.getSelection
      ? shadowRootWithSelection.getSelection()!
      : window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
  });

  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button[data-color="yellow"]').click();
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);

  // Reload: the fixture is static (no shadow root of its own — see
  // attachShadowSentence's header comment), so the shadow tree is rebuilt the
  // same way before the annotator re-injects. The anchor must still resolve
  // from its stored shadowHost and repaint against that rebuilt tree.
  await page.reload();
  await attachShadowSentence(page);
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);

  // Persistence carries the shadowHost.
  const stored = await page.evaluate(async () => {
    return (await chrome.runtime.sendMessage({
      type: 'web/annotationsForUrl',
      projectId: '',
      url: location.href,
    })) as { ok: true; data: { annotations: Array<{ anchor: { shadowHost?: string } }> } };
  });
  expect(stored.data.annotations).toHaveLength(1);
  expect(stored.data.annotations[0]?.anchor.shadowHost).toBeTruthy();
  await page.close();
});

test('"show me that highlight" scrolls the open page to it, without opening a duplicate tab', async () => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(`chrome-extension://${extensionId}/e2e-tall-article.html`);
  await page.addScriptTag({ url: annotatorUrl() });

  // Highlight a passage far down the page.
  await page.evaluate((quote) => {
    const p = [...document.querySelectorAll('p')].find((el) => el.textContent === quote)!;
    p.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, TALL_TARGET);
  await page.locator('#context-notes-annotator .toolbar button[data-color="blue"]').click();
  await expect(page.locator('#context-notes-annotator .ov')).not.toHaveCount(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const target = await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const annos = (await chrome.runtime.sendMessage({
      type: 'annotations/listByProject',
      projectId: projects.data[0]!.id,
    })) as { data: Array<{ id: string; documentId: string }> };
    const docs = (await chrome.runtime.sendMessage({
      type: 'documents/listByProject',
      projectId: projects.data[0]!.id,
    })) as { data: Array<{ id: string; url: string }> };
    const anno = annos.data.find((a) =>
      docs.data.some((d) => d.id === a.documentId && d.url.includes('tall')),
    )!;
    return { id: anno.id, url: docs.data.find((d) => d.id === anno.documentId)!.url };
  });

  // Ask from another extension page, exactly as the dashboard does.
  const asker = await context.newPage();
  await asker.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  const result = await asker.evaluate(
    async (t) =>
      chrome.runtime.sendMessage({ control: 'annotator/openAndJump', url: t.url, id: t.id }),
    target,
  );
  expect(result).toEqual({ ok: true });

  // It scrolled the page that was already open — no duplicate tab.
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  expect(context.pages().filter((p) => p.url().includes('e2e-tall-article')).length).toBe(1);
  await asker.close();
  await page.close();
});

test("the side panel jumps by URL, so it lands on the notes' page and not the active tab", async () => {
  // The panel outlives tab switches: a jump sent blind to "the active tab"
  // landed wherever the user happened to be looking. It now addresses the
  // page the notes belong to, which is what these two tabs prove.
  const article = await context.newPage();
  await article.setViewportSize({ width: 900, height: 500 });
  await article.goto(`chrome-extension://${extensionId}/e2e-tall-article.html`);
  await article.addScriptTag({ url: annotatorUrl() });
  await article.evaluate((quote) => {
    const p = [...document.querySelectorAll('p')].find((el) => el.textContent === quote)!;
    p.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, TALL_TARGET);
  await article.locator('#context-notes-annotator .toolbar button[data-color="pink"]').click();
  await expect(article.locator('#context-notes-annotator .ov')).not.toHaveCount(0);
  await article.evaluate(() => window.scrollTo(0, 0));

  // A DIFFERENT tab is the active one when the jump is asked for.
  const decoy = await context.newPage();
  await decoy.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  await decoy.bringToFront();

  const target = await decoy.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const annos = (await chrome.runtime.sendMessage({
      type: 'annotations/listByProject',
      projectId: projects.data[0]!.id,
    })) as { data: Array<{ id: string; documentId: string }> };
    const docs = (await chrome.runtime.sendMessage({
      type: 'documents/listByProject',
      projectId: projects.data[0]!.id,
    })) as { data: Array<{ id: string; url: string }> };
    const doc = docs.data.find((d) => d.url.includes('tall'))!;
    const anno = annos.data.filter((a) => a.documentId === doc.id).at(-1)!;
    return { id: anno.id, url: doc.url };
  });
  await decoy.evaluate(
    async (t) =>
      chrome.runtime.sendMessage({ control: 'annotator/openAndJump', url: t.url, id: t.id }),
    target,
  );

  // The article scrolled, even though it was not the active tab.
  await expect.poll(() => article.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await decoy.close();
  await article.close();
});

function panelUrl(): string {
  return `chrome-extension://${extensionId}/${path.posix.join('src', 'sidepanel', 'index.html')}`;
}

/**
 * The panel's "Notes on this page" list only appears for a preview whose URL
 * matches `/^https?:/` (`isCapturablePreview`), and getting one populated
 * needs `scanActiveTab`'s `chrome.scripting.executeScript` to succeed — which
 * needs a real `activeTab` grant Playwright cannot produce any more than it
 * could for annotator activation (see this file's header comment). Faking
 * the scan's result is the same class of workaround: it lets production code
 * (`buildCaptureInput`, `isCapturablePreview`, `renderOnPageCard`) run
 * unmodified against a URL that satisfies the gate, with no real
 * network-reachable page required.
 */
async function stubActiveTabScan(page: Page, url: string, title: string): Promise<void> {
  await page.addInitScript(
    ({ url, title }) => {
      const tabs = chrome.tabs as unknown as {
        query: (query: unknown) => Promise<Array<{ id: number }>>;
      };
      tabs.query = () => Promise.resolve([{ id: 999999 }]);
      const scripting = chrome.scripting as unknown as {
        executeScript: (details: unknown) => Promise<Array<{ result: unknown }>>;
      };
      scripting.executeScript = () =>
        Promise.resolve([{ result: { url, raw: { title, metaTags: {} } } }]);
    },
    { url, title },
  );
}

test('assigning a section from the panel updates the card', async () => {
  const sourceUrl = 'https://example.org/e2e-section-test';
  const page = await context.newPage();
  await stubActiveTabScan(page, sourceUrl, 'Section test source');
  await page.goto(panelUrl());
  await expect(page.locator('#activeName')).toHaveText('My Research');

  // Seed a web annotation the same way a real highlight commits
  // (`web/annotate`) rather than driving the real annotator: this test is
  // about the section picker, not anchoring, and the annotator can't paint
  // onto a URL that only exists via the scan stub above.
  await page.evaluate(async (url) => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    await chrome.runtime.sendMessage({
      type: 'web/annotate',
      input: {
        projectId: projects.data[0]!.id,
        url,
        type: 'article',
        metadata: { title: 'Section test source' },
      },
      anchor: {
        kind: 'web',
        selectors: [{ type: 'textQuote', exact: 'A passage worth citing.' }],
      },
      color: 'yellow',
    });
  }, sourceUrl);

  // Reload onto the panel's real init path — `loadPreview` → `loadPageAnnotations`
  // → `renderOnPageCard` — the same path a fresh open runs, so the card under
  // test is exactly what a user would see.
  await page.reload();
  const pick = page.locator('.onpage-note__section').first();
  await expect(pick).toBeVisible();
  await pick.selectOption({ label: 'Evidence' });
  await expect(pick).toHaveValue(/.+/);
  const chosen = await pick.inputValue();

  // The write is optimistic AND the list repaints; if `section` were missing
  // from `onPageSignature` this would still show the old (empty) value on
  // reload even though the database was already correct — exactly the bug
  // Task 6's fold-in of `section` guards against.
  await page.reload();
  await expect(page.locator('.onpage-note__section').first()).toHaveValue(chosen);
  await page.close();
});

test('a dangling section id falls back to "No section" instead of leaving the picker blank', async () => {
  const sourceUrl = 'https://example.org/e2e-dangling-section';
  const page = await context.newPage();
  await stubActiveTabScan(page, sourceUrl, 'Dangling section source');
  await page.goto(panelUrl());
  await expect(page.locator('#activeName')).toHaveText('My Research');

  await page.evaluate(async (url) => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    const annotated = (await chrome.runtime.sendMessage({
      type: 'web/annotate',
      input: {
        projectId: projects.data[0]!.id,
        url,
        type: 'article',
        metadata: { title: 'Dangling section source' },
      },
      anchor: {
        kind: 'web',
        selectors: [{ type: 'textQuote', exact: 'A passage with a dangling section.' }],
      },
      color: 'yellow',
    })) as { data: { documentId: string; annotationId: string } };
    const byDoc = (await chrome.runtime.sendMessage({
      type: 'annotations/listByDocument',
      documentId: annotated.data.documentId,
    })) as { data: Array<Record<string, unknown>> };
    const annotation = byDoc.data.find((a) => a['id'] === annotated.data.annotationId)!;
    // A section id that names no section the resolved outline currently has
    // — reachable in production via `performDeleteSection`'s partial-failure
    // branch (the section removed from `project.outline`, but a later write
    // in that same loop fails before this annotation's own `.section` is
    // cleared). Reproduced directly here since the picker's fallback is what
    // is under test, not how the dangling id came to exist.
    await chrome.runtime.sendMessage({
      type: 'annotations/put',
      annotation: { ...annotation, section: 'no-such-section' },
    });
  }, sourceUrl);

  await page.reload();
  const pick = page.locator('.onpage-note__section').first();
  await expect(pick).toBeVisible();
  // `selectedIndex` must land on the real "No section" option, not fall
  // through to -1 (nothing selected, an empty-looking picker) just because
  // the stored id doesn't match any <option> the resolved outline produced.
  await expect(pick).toHaveValue('');
  await page.close();
});
