import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { copyFileSync, rmSync } from 'node:fs';
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

test('highlighting a selection paints an overlay that repaints after reload, and persists', async () => {
  const page = await context.newPage();
  await page.goto(fixtureUrl());
  await expect(page.locator('main[style*="position: relative"] p', { hasText: targetSentence })).toBeVisible();

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

  // The selection's own client rect — the ground truth the overlay must
  // match. Captured before commit() clears the selection.
  const expectedRect = await page.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0).getClientRects()[0];
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  });
  expect(expectedRect).not.toBeNull();

  await page.locator('#context-notes-annotator .toolbar button', { hasText: 'Highlight' }).click();

  // The overlay exists in the shadow root, and lines up with the selection —
  // the regression a `position: fixed` overlay layer (immune to the
  // `position: relative` <main> ancestor above) guards against.
  const overlay = page.locator('#context-notes-annotator .ov');
  await expect(overlay).toHaveCount(1);
  const ovBox = await overlay.boundingBox();
  expect(ovBox).not.toBeNull();
  if (ovBox && expectedRect) {
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
  const ovBoxAfterReload = await overlayAfterReload.boundingBox();
  expect(ovBoxAfterReload).not.toBeNull();
  if (ovBoxAfterReload && expectedRect) {
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
    })) as { ok: true; data: { annotations: Array<{ anchor: { selectors: Array<{ type: string; exact?: string }> } }> } };
    return res;
  });
  expect(stored.ok).toBe(true);
  expect(stored.data.annotations).toHaveLength(1);
  const quoteSelector = stored.data.annotations[0]?.anchor.selectors.find((s) => s.type === 'textQuote');
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
    const runtime = chrome.runtime as unknown as { sendMessage: (m: unknown, ...r: unknown[]) => Promise<unknown> };
    const orig = runtime.sendMessage.bind(chrome.runtime);
    runtime.sendMessage = (m: unknown, ...r: unknown[]) =>
      (m as { type?: string })?.type === 'web/annotate'
        ? Promise.reject(new Error('simulated: service worker asleep'))
        : orig(m, ...r);
  });

  await selectTargetSentence(page);
  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button', { hasText: 'Highlight' }).click();

  // The commit's send rejected — but `commit()` must catch it: the toolbar is
  // dismissed (not left stuck over the selection) and nothing is painted. Before
  // the fix this rejected unhandled and left the toolbar open.
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
  await page.locator('#context-notes-annotator .toolbar button', { hasText: 'Highlight' }).click();
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
    const sel = shadowRootWithSelection.getSelection ? shadowRootWithSelection.getSelection()! : window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
  });

  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button', { hasText: 'Highlight' }).click();
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
