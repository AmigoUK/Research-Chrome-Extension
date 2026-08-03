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
// Shared with scripts/store-assets.mjs — the README images and the Web Store
// images must show the same project, or the listing and the repo disagree.
import { seedDemoProject } from './lib/seed-demo-project.mjs';

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

await page.evaluate(seedDemoProject, pdfBase64);

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
