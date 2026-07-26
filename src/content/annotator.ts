/**
 * Injected web-page annotator (ISOLATED world). Renders only inside a shadow
 * root — a selection toolbar and absolutely-positioned highlight overlays. It
 * never wraps or mutates page nodes (that would break page layout/reactivity):
 * highlights are overlay rects computed from Range.getClientRects().
 */
import { createWebAnchor, resolveWebAnchor } from '../core/anchoring/web';
import { scanDocumentRaw, buildCaptureInput } from '../adapters/chrome/page-scan';
import { getActiveProjectId } from '../adapters/chrome/active-project';
import type { Annotation, WebAnchor } from '../core/model/types';
import annotatorCss from './annotator.css?inline';

const HOST_ID = 'context-notes-annotator';

interface Painted {
  annotation: Annotation;
  anchor: WebAnchor;
  // Resolved once (on load / on `annotator/changed`), not on every scroll —
  // see the scroll handler below. `null` means the anchor didn't resolve on
  // this load (text shifted since capture) and stays unpainted.
  range: Range | null;
}

const painted: Painted[] = [];

// Registered once per origin per session — the SW's registerOrigin handler is
// idempotent, but calling it on every commit still unregisters+re-registers
// the content script every time a note is saved, which is needless churn.
const registeredOrigins = new Set<string>();

function shadowRoot(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (host?.shadowRoot) return host.shadowRoot;
  host = document.createElement('div');
  host.id = HOST_ID;
  // Fixed to the viewport (not `absolute` on `body`) so a `position: relative`
  // or transformed ancestor can't become the containing block and shift the
  // overlay origin. Hung off `documentElement` rather than `body` for the same
  // reason: minimizes the chance an ancestor transform captures it.
  host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = annotatorCss;
  root.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.appendChild(layer);
  document.documentElement.appendChild(host);
  return root;
}

function overlayLayer(): HTMLElement {
  return shadowRoot().querySelector('.layer') as HTMLElement;
}

function pageRects(range: Range): DOMRect[] {
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

function paintOne(id: string, rects: DOMRect[]): void {
  const layer = overlayLayer();
  // The layer is `position: fixed`, so client rects are already
  // viewport-relative — no window.scrollX/scrollY offset needed (and adding
  // one would double-count the scroll on a fixed-position ancestor).
  for (const r of rects) {
    const ov = document.createElement('div');
    ov.className = 'ov';
    ov.dataset.id = id;
    ov.style.left = `${r.left}px`;
    ov.style.top = `${r.top}px`;
    ov.style.width = `${r.width}px`;
    ov.style.height = `${r.height}px`;
    ov.addEventListener('click', () => {
      chrome.runtime.sendMessage({ control: 'annotator/focus', id }).catch(() => {});
    });
    layer.appendChild(ov);
  }
}

/** Resolves every anchor to a `Range` ONCE (a text-quote search per note) and
 *  caches it on the `painted` entry, then paints from that cache. Returns the
 *  ids that resolved successfully — so callers can tell the side panel which
 *  annotations actually landed on this load of the page (text may have
 *  shifted since the anchor was captured). This is the only place resolution
 *  happens: scroll/resize below only repositions the cached ranges. */
function resolveAndRepaintAll(): string[] {
  const resolvedIds: string[] = [];
  for (const p of painted) {
    p.range = resolveWebAnchor(document.body, p.anchor);
    if (p.range) resolvedIds.push(p.annotation.id);
  }
  repositionAll();
  return resolvedIds;
}

/** Repositions overlays from the already-resolved `Range` cache — no anchor
 *  re-resolution (no text-quote search). Safe to call on every scroll/resize
 *  tick (throttled to one call per animation frame, see below). */
function repositionAll(): void {
  overlayLayer().replaceChildren();
  for (const p of painted) {
    paintOne(p.annotation.id, p.range ? pageRects(p.range) : []);
  }
}

function jumpTo(id: string): void {
  const overlays = shadowRoot().querySelectorAll<HTMLElement>(`.ov[data-id="${CSS.escape(id)}"]`);
  const first = overlays[0];
  if (!first) return;
  first.scrollIntoView({ block: 'center' });
  overlays.forEach((ov) => ov.classList.add('flash'));
  setTimeout(() => overlays.forEach((ov) => ov.classList.remove('flash')), 1200);
}

async function commit(range: Range, withNote: boolean): Promise<void> {
  const anchor = createWebAnchor(document.body, range);
  const scan = scanDocumentRaw();
  const projectId = (await getActiveProjectId()) ?? '';
  const input = buildCaptureInput(scan, projectId);
  const res = (await chrome.runtime.sendMessage({ type: 'web/annotate', input, anchor, withNote })) as
    | { ok: true; data: { documentId: string; annotationId: string } }
    | { ok: false; error: string };
  if (!res.ok) return;
  // Opt this origin in for future page loads. Idempotent on the SW side, but
  // only send it once per origin per session to avoid re-registering the
  // content script on every commit.
  if (!registeredOrigins.has(location.origin)) {
    registeredOrigins.add(location.origin);
    chrome.runtime.sendMessage({ control: 'annotator/registerOrigin', origin: location.origin }).catch(() => {});
  }
  paintOne(res.data.annotationId, pageRects(range));
  window.getSelection()?.removeAllRanges();
  hideToolbar();
  // Let the service worker open the side panel + broadcast the change.
  chrome.runtime.sendMessage({ control: 'annotator/changed', url: scan.url }).catch(() => {});
}

let toolbar: HTMLElement | null = null;

function hideToolbar(): void {
  toolbar?.remove();
  toolbar = null;
}

function showToolbar(x: number, y: number, range: Range): void {
  hideToolbar();
  const el = document.createElement('div');
  el.className = 'toolbar';
  for (const [label, withNote] of [
    ['Highlight', false],
    ['Note', true],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      void commit(range, withNote);
    });
    el.appendChild(b);
  }
  // Viewport coordinates, unadjusted — see paintOne's comment on the fixed layer.
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  overlayLayer().appendChild(el);
  toolbar = el;
}

function onMouseUp(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideToolbar();
    return;
  }
  const range = sel.getRangeAt(0);
  const rects = pageRects(range);
  const last = rects[rects.length - 1];
  if (!last) return;
  // Clamp so a selection near the viewport top never pushes the toolbar
  // off-screen above y=0.
  showToolbar(last.left, Math.max(4, last.top - 40), range);
}

async function loadExisting(): Promise<void> {
  const projectId = (await getActiveProjectId()) ?? '';
  const scan = scanDocumentRaw();
  const res = (await chrome.runtime.sendMessage({
    type: 'web/annotationsForUrl',
    projectId,
    url: scan.url,
  })) as { ok: true; data: { annotations: Annotation[] } } | { ok: false };
  if (!res.ok) return;
  painted.length = 0;
  for (const annotation of res.data.annotations) {
    if (annotation.anchor.kind === 'web') painted.push({ annotation, anchor: annotation.anchor, range: null });
  }
  const resolvedIds = resolveAndRepaintAll();
  chrome.runtime.sendMessage({ control: 'annotator/resolved', url: scan.url, resolvedIds }).catch(() => {});
}

// Coalesce scroll/resize into at most one reposition per animation frame —
// `repositionAll` is cheap (no anchor re-resolution) but firing it once per
// scroll event is still needless churn on a fast trackpad fling.
let repaintScheduled = false;
function scheduleReposition(): void {
  if (repaintScheduled) return;
  repaintScheduled = true;
  requestAnimationFrame(() => {
    repaintScheduled = false;
    repositionAll();
  });
}

// A second `executeScript` injection (e.g. a double-click on the side
// panel's "Annotate this page" button) must not register a second set of
// `document`/`window`/`runtime.onMessage` listeners — that produces
// duplicate toolbars and two `painted` arrays fighting over the shared
// shadow layer. On re-activation in an already-initialized page, just
// re-sync from storage and stop; the first instance's listeners still own
// the page.
const w = window as unknown as { __contextNotesAnnotator?: boolean };
if (w.__contextNotesAnnotator) {
  void loadExisting();
} else {
  w.__contextNotesAnnotator = true;

  document.addEventListener('mouseup', () => setTimeout(onMouseUp, 0));
  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition);
  chrome.runtime.onMessage.addListener((m: { control?: string; id?: string }) => {
    if (m?.control === 'annotator/changed') void loadExisting();
    else if (m?.control === 'annotator/jump' && m.id) jumpTo(m.id);
  });

  void loadExisting();
}
