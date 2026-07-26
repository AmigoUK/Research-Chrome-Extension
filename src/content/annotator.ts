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
}

const painted: Painted[] = [];

function shadowRoot(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (host?.shadowRoot) return host.shadowRoot;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = annotatorCss;
  root.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.appendChild(layer);
  document.body.appendChild(host);
  return root;
}

function overlayLayer(): HTMLElement {
  return shadowRoot().querySelector('.layer') as HTMLElement;
}

function pageRects(range: Range): DOMRect[] {
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

function paintOne(id: string, rects: DOMRect[], moved: boolean): void {
  const layer = overlayLayer();
  const sx = window.scrollX;
  const sy = window.scrollY;
  for (const r of rects) {
    const ov = document.createElement('div');
    ov.className = `ov${moved ? ' moved' : ''}`;
    ov.dataset.id = id;
    ov.style.left = `${r.left + sx}px`;
    ov.style.top = `${r.top + sy}px`;
    ov.style.width = `${r.width}px`;
    ov.style.height = `${r.height}px`;
    ov.addEventListener('click', () => {
      chrome.runtime.sendMessage({ control: 'annotator/focus', id }).catch(() => {});
    });
    layer.appendChild(ov);
  }
}

function repaintAll(): void {
  overlayLayer().replaceChildren();
  for (const p of painted) {
    const range = resolveWebAnchor(document.body, p.anchor);
    paintOne(p.annotation.id, range ? pageRects(range) : [], false);
  }
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
  paintOne(res.data.annotationId, pageRects(range), false);
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
  el.style.left = `${x + window.scrollX}px`;
  el.style.top = `${y + window.scrollY}px`;
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
  showToolbar(last.left, last.top - 40, range);
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
    if (annotation.anchor.kind === 'web') painted.push({ annotation, anchor: annotation.anchor });
  }
  repaintAll();
}

document.addEventListener('mouseup', () => setTimeout(onMouseUp, 0));
window.addEventListener('scroll', repaintAll, { passive: true });
window.addEventListener('resize', repaintAll);
chrome.runtime.onMessage.addListener((m: { control?: string }) => {
  if (m?.control === 'annotator/changed') void loadExisting();
});

void loadExisting();
