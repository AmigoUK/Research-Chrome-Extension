/**
 * Render the Chrome Web Store listing images.
 *
 * The store accepts screenshots at exactly 1280×800 or 640×400 and nothing
 * else — `doc/screenshots/` is 1360×940 and 400×820, so every one of those
 * would be refused at upload. Rather than reshoot the README set at a size that
 * suits a store carousel and not a document, this writes a separate, purpose-cut
 * set to `doc/store/`.
 *
 *   npm run build && xvfb-run -a npm run store:assets
 *
 * How it works: the same demo project as the README screenshots
 * (`scripts/lib/seed-demo-project.mjs`) is photographed at 2× device pixels,
 * then composed into a 1280×800 frame with a caption. Capturing at 2× and
 * placing the result at 1120 CSS pixels keeps the UI crisp after the downscale;
 * shooting straight at 1280×800 and leaving no room for a caption would be
 * sharper but mute, and a store carousel is read at thumbnail size.
 *
 * The side panel is 400 px wide by design, which is not a legal screenshot
 * shape at all — it is composed onto the same canvas beside its caption.
 *
 * Promo tiles are plain HTML screenshotted at the exact tile size. Fonts come
 * from the bundled @fontsource files as data URIs: no network, and the tiles use
 * the same display face as the product.
 */
import { chromium } from '@playwright/test';
import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedDemoProject } from './lib/seed-demo-project.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = `${ROOT}dist`;
const OUT = `${ROOT}doc/store`;

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// --- brand, lifted from src/options/dashboard.css so the tiles match the app ---
const ACCENT = 'oklch(52% 0.10 28)';
const FG = 'oklch(20% 0.018 70)';
const MUTED = 'oklch(45% 0.014 70)';
const PAPER = 'oklch(98% 0.004 95)';

const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;
const font = (file) => dataUri(`${ROOT}node_modules/@fontsource/${file}`, 'font/woff2');

const FONT_FACES = `
  @font-face {
    font-family: 'Charis SIL'; font-weight: 700; font-display: block;
    src: url('${font('charis-sil/files/charis-sil-latin-700-normal.woff2')}') format('woff2');
  }
  @font-face {
    font-family: 'Charis SIL'; font-weight: 400; font-display: block;
    src: url('${font('charis-sil/files/charis-sil-latin-400-normal.woff2')}') format('woff2');
  }
  @font-face {
    font-family: 'IBM Plex Mono'; font-weight: 600; font-display: block;
    src: url('${font('ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2')}') format('woff2');
  }
`;

// The 128px PNG rather than icon.svg: Chrome refuses to paint a base64 SVG data
// URI in an <img>, and a broken-image glyph on a promo tile is not recoverable.
const ICON = dataUri(`${ROOT}src/assets/icons/icon-128.png`, 'image/png');

/** Reads width/height straight out of the PNG IHDR — no image dependency. */
function pngSize(path) {
  const head = readFileSync(path).subarray(16, 24);
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
}

const context = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox'],
  // 24px taller than the frame needs: the composed image crops the bottom, which
  // is where a viewport-height cut lands mid-line through the app's own footer.
  viewport: { width: 1280, height: 824 },
  deviceScaleFactor: 2, // captures at 2560×1648 so the composed downscale stays sharp
});
let [worker] = context.serviceWorkers();
worker ??= await context.waitForEvent('serviceworker');
const extensionId = worker.url().split('/')[2];
const url = (path) => `chrome-extension://${extensionId}/${path}`;

const page = await context.newPage();
await page.goto(url('src/options/index.html'));
await page.waitForTimeout(700);
await page.evaluate(
  seedDemoProject,
  readFileSync(`${ROOT}e2e/fixtures/sample.pdf`).toString('base64'),
);
await page.reload();
await page.waitForTimeout(1200);

/** A composing page with no extension privileges — it only renders HTML. */
const canvas = await context.newPage();

async function renderAt(html, width, height, out) {
  await canvas.setViewportSize({ width, height });
  await canvas.setContent(html, { waitUntil: 'load' });
  await canvas.evaluate(() => document.fonts.ready);
  await canvas.waitForTimeout(150);
  // deviceScaleFactor is 2, so ask for the CSS-pixel size the store expects.
  await canvas.screenshot({ path: out, scale: 'css' });
  const { width: w, height: h } = pngSize(out);
  if (w !== width || h !== height) {
    throw new Error(`${out} came out ${w}×${h}, expected ${width}×${height}`);
  }
  console.log(`wrote ${out.slice(ROOT.length)} (${w}×${h})`);
}

const frame = (inner) => `<!doctype html><meta charset="utf-8"><style>
  ${FONT_FACES}
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1280px; height: 800px; overflow: hidden;
    font-family: 'Charis SIL', Georgia, serif; color: ${FG};
    background:
      radial-gradient(120% 90% at 12% -10%, oklch(94% 0.03 40) 0%, transparent 55%),
      ${PAPER};
  }
  h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.01em; }
  p { font-size: 17px; color: ${MUTED}; margin-top: 6px; }
  .shot {
    border-radius: 10px; border: 1px solid oklch(88% 0.008 70);
    box-shadow: 0 18px 44px oklch(30% 0.03 40 / 0.16), 0 2px 6px oklch(30% 0.03 40 / 0.08);
    display: block;
  }
</style>${inner}`;

/** Wide surfaces: caption on top, the 16:10 capture filling the rest. */
const wideFrame = (shot, title, sub) =>
  frame(`<div style="padding:22px 80px 0">
    <h1>${title}</h1><p>${sub}</p>
  </div>
  <img class="shot" src="${shot}" width="1120" height="700"
       style="margin:14px auto 0; width:1120px; height:700px; object-fit:cover; object-position:top left">`);

/** The side panel is 400px wide — it gets the canvas beside its caption. */
const panelFrame = (shot, title, sub) =>
  frame(`<div style="display:flex; align-items:center; height:800px; padding:0 78px; gap:64px">
    <div style="flex:1">
      <img src="${ICON}" width="52" height="52" style="border-radius:12px; margin-bottom:20px">
      <h1 style="font-size:36px">${title}</h1>
      <p style="font-size:19px; line-height:1.5; margin-top:12px">${sub}</p>
    </div>
    <img class="shot" src="${shot}" style="width:352px; height:704px; flex:none">
  </div>`);

async function shotOf(target, wait = 500) {
  await target.waitForTimeout(wait);
  return `data:image/png;base64,${(await target.screenshot()).toString('base64')}`;
}

// --- 1 · dashboard overview -------------------------------------------------
const overviewShot = await shotOf(page); // reused as the marquee's artwork
await renderAt(
  wideFrame(
    overviewShot,
    'Every source in one research workspace',
    'Projects, a Kanban of reading status, and the numbers that tell you where the work actually is.',
  ),
  1280,
  800,
  `${OUT}/screenshot-1-overview.png`,
);

// --- 2 · annotations --------------------------------------------------------
await page.locator('#nav .nav-item[data-route="annotations"]').click();
await renderAt(
  wideFrame(
    await shotOf(page),
    'Every note keeps the passage it came from',
    'Notes are anchored to the exact quote, tagged, and tracked from draft to “used in report”.',
  ),
  1280,
  800,
  `${OUT}/screenshot-2-annotations.png`,
);

// --- 3 · citation style editor ---------------------------------------------
await page.locator('#nav .nav-item[data-route="styles"]').click();
await page.waitForTimeout(500);
await page.locator('.style-card').first().click();
await page.locator('#sFull').click();
await page.waitForTimeout(1600); // the preview formats through real citeproc
await renderAt(
  wideFrame(
    await shotOf(page),
    'Real CSL citations, and a style editor that shows its work',
    'APA, MLA, Chicago and Harvard through citeproc — tweak a rule and watch the bibliography change.',
  ),
  1280,
  800,
  `${OUT}/screenshot-3-citation-styles.png`,
);

// --- 4 · PDF reader ---------------------------------------------------------
const reader = await context.newPage();
await reader.setViewportSize({ width: 1280, height: 824 });
await reader.goto(url('src/pdfviewer/index.html?documentId=d-pdf'));
await reader.waitForTimeout(2600); // pdf.js paints the page to a canvas first
// The fixture PDF has a small page box; at the default 125% it floats in grey.
for (let i = 0; i < 4; i++) await reader.locator('#zIn').click();
await renderAt(
  wideFrame(
    await shotOf(reader, 1200),
    'Read and annotate PDFs in the browser',
    'A bundled reader — highlight a region, attach a note, and it stays anchored to that spot on that page.',
  ),
  1280,
  800,
  `${OUT}/screenshot-4-pdf-reader.png`,
);
await reader.close();

// --- 5 · side panel ---------------------------------------------------------
const panel = await context.newPage();
await panel.setViewportSize({ width: 400, height: 800 });
await panel.goto(url('src/sidepanel/index.html'));
await renderAt(
  panelFrame(
    await shotOf(panel, 1400),
    'Your reading list, beside the page',
    'The side panel files what you are reading, shows the notes already on that page, and keeps every source and its status one click away.',
  ),
  1280,
  800,
  `${OUT}/screenshot-5-side-panel.png`,
);
await panel.close();

// --- promo tiles ------------------------------------------------------------
const tile = (width, height, scale, art = '') => `<!doctype html><meta charset="utf-8"><style>
  ${FONT_FACES}
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${width}px; height: ${height}px; overflow: hidden; display: flex;
    flex-direction: column; justify-content: center; gap: ${14 * scale}px;
    padding: ${28 * scale}px ${34 * scale}px;
    position: relative;
    font-family: 'Charis SIL', Georgia, serif; color: ${FG};
    background:
      radial-gradient(130% 120% at 88% 6%, oklch(93% 0.045 38) 0%, transparent 60%),
      radial-gradient(90% 110% at 4% 96%, oklch(95% 0.02 90) 0%, transparent 62%),
      ${PAPER};
  }
  .row { display: flex; align-items: center; gap: ${13 * scale}px; }
  .name { font-size: ${21 * scale}px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.1; }
  .line {
    font-size: ${14.5 * scale}px; color: ${MUTED}; line-height: 1.45;
    max-width: ${art ? 620 : 330 * scale}px;
  }
  .badge {
    align-self: flex-start; font-family: 'IBM Plex Mono', monospace; font-weight: 600;
    font-size: ${9.5 * scale}px; letter-spacing: 0.09em; text-transform: uppercase;
    color: ${ACCENT}; border: 1px solid oklch(52% 0.10 28 / 0.32);
    border-radius: 999px; padding: ${4 * scale}px ${10 * scale}px;
  }
  /* The marquee is twice as wide as the tile for the same copy, so the empty
     half gets the product itself, bleeding off the right edge. */
  .art {
    position: absolute; right: -54px; top: 50%;
    transform: translateY(-50%) rotate(-3.5deg);
    width: 660px; border-radius: 14px;
    border: 1px solid oklch(88% 0.008 70);
    box-shadow: 0 26px 60px oklch(30% 0.03 40 / 0.2);
  }
  .row, .line, .badge { position: relative; z-index: 1; }
</style>
${art ? `<img class="art" src="${art}">` : ''}
<div class="row">
  <img src="${ICON}" width="${44 * scale}" height="${44 * scale}" style="border-radius:${10 * scale}px">
  <div class="name">Scientific<br>Context Notes</div>
</div>
<div class="line">File pages and PDFs into research projects, anchor every note to the passage it came from, and cite with real CSL.</div>
<div class="badge">Local-first · no account · no backend</div>`;

await renderAt(tile(440, 280, 1), 440, 280, `${OUT}/promo-small-440x280.png`);
await renderAt(tile(1400, 560, 2.6, overviewShot), 1400, 560, `${OUT}/promo-marquee-1400x560.png`);

await context.close();

const written = readdirSync(OUT).filter((f) => f.endsWith('.png'));
console.log(
  `\n${written.length} store images in doc/store/ — all at a size the Web Store accepts.`,
);
