/**
 * PDF reader controller (viewer surface). Vanilla TS. Renders a stored PDF with
 * pdf.js (one page at a time, canvas), with zoom and page navigation. Text/region
 * anchoring and the annotations rail arrive in later milestones.
 *
 * Data (the Document + its file bytes) comes through the typed messaging layer;
 * bytes arrive as base64 and are decoded for pdf.js.
 */
import './pdfviewer.css';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { sendRequest } from '../adapters/chrome/messaging';
import { base64ToBytes } from '../core/files/base64';
import {
  createPdfAnchor,
  resolvePdfAnchor,
  anchorPage,
  anchorQuote,
  isRegionAnchor,
  type PxRect,
} from '../core/anchoring/pdf';
import type { Document, Annotation, AnnotationStatus, Id } from '../core/model/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(sel)];

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.75;

const ICON = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  hl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l-4 4v4h4l4-4M13 7l4 4M8 16l9-9 3 3-9 9"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  region:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 3"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
};
const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

const ANNO_STATUS: Record<AnnotationStatus, string> = {
  draft: 'Draft',
  accepted: 'Accepted',
  rejected: 'Rejected',
  includedInReport: 'In report',
};
const ANNO_STATUSES = Object.keys(ANNO_STATUS) as AnnotationStatus[];

interface PendingSelection {
  page: number;
  quote: string;
  rects: PxRect[];
  box: { width: number; height: number };
}

interface ViewerState {
  documentId: Id | null;
  document: Document | null;
  pdf: PDFDocumentProxy | null;
  pageNum: number;
  numPages: number;
  zoom: number;
  annotations: Annotation[];
  mode: 'text' | 'region';
  scope: 'page' | 'all';
  pending: PendingSelection | null;
  activeId: Id | null;
}
const state: ViewerState = {
  documentId: null,
  document: null,
  pdf: null,
  pageNum: 1,
  numPages: 1,
  zoom: 1.25,
  annotations: [],
  mode: 'text',
  scope: 'page',
  pending: null,
  activeId: null,
};

function nowIso(): string {
  return new Date().toISOString();
}

function stageMessage(title: string, desc: string): void {
  $('#pagescale').innerHTML = '';
  const wrap = $('#pagewrap');
  wrap.innerHTML = `<div class="stage-msg"><div class="et">${title}</div><div class="ed">${desc}</div></div>`;
}

/* ---- Load ---- */
async function loadDocument(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  state.documentId = params.get('documentId');
  if (!state.documentId) {
    stageMessage('No document', 'Open a PDF from the dashboard to read and annotate it.');
    return;
  }

  const document_ = await sendRequest({ type: 'documents/get', id: state.documentId });
  if (!document_) {
    stageMessage('Document not found', 'This document may have been removed.');
    return;
  }
  state.document = document_;
  $('#docTitle').textContent = document_.metadata.title ?? 'Untitled PDF';
  const project = document_.section ? ` · ${document_.section}` : '';
  $('#docSub').textContent = `PDF${project}`;

  if (!document_.fileId) {
    stageMessage('No file attached', 'This document has no stored PDF to display.');
    return;
  }
  const file = await sendRequest({ type: 'files/get', id: document_.fileId });
  if (!file) {
    stageMessage('File missing', 'The PDF bytes for this document could not be found.');
    return;
  }

  const data = new Uint8Array(base64ToBytes(file.dataBase64));
  state.pdf = await pdfjs.getDocument({ data }).promise;
  state.numPages = state.pdf.numPages;
  state.pageNum = 1;
  $('#pgTot').textContent = String(state.numPages);
  state.annotations = await sendRequest({
    type: 'annotations/listByDocument',
    documentId: state.documentId,
  });
  await renderPage();
  renderRail();
}

async function renderPage(): Promise<void> {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.pageNum);
  const dpr = window.devicePixelRatio || 1;
  const cssViewport = page.getViewport({ scale: state.zoom });
  const renderViewport = page.getViewport({ scale: state.zoom * dpr });
  const w = Math.floor(cssViewport.width);
  const h = Math.floor(cssViewport.height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const pageEl = document.createElement('div');
  pageEl.className = 'pdf-page';
  pageEl.dataset.page = String(state.pageNum);
  pageEl.style.width = `${w}px`;
  pageEl.style.height = `${h}px`;
  // pdf.js text layer positions spans via this scale factor.
  pageEl.style.setProperty('--scale-factor', String(state.zoom));
  pageEl.appendChild(canvas);

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'textLayer';
  pageEl.appendChild(textLayerDiv);

  const annoLayer = document.createElement('div');
  annoLayer.className = 'anno-layer';
  pageEl.appendChild(annoLayer);

  $('#pagescale').replaceChildren(pageEl);

  await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textLayerDiv,
    viewport: cssViewport,
  });
  await textLayer.render();

  renderOverlays(annoLayer, { width: w, height: h });

  $('#pgCur').textContent = String(state.pageNum);
  $('#pagewrap').scrollTop = 0;
  syncControls();
}

function renderOverlays(layer: HTMLElement, box: { width: number; height: number }): void {
  layer.innerHTML = '';
  for (const anno of state.annotations) {
    if (anno.anchor.kind !== 'pdf') continue;
    if (anchorPage(anno.anchor) !== state.pageNum) continue;
    const region = isRegionAnchor(anno.anchor);
    const rects = resolvePdfAnchor(anno.anchor, box);
    rects.forEach((r, i) => {
      const ov = document.createElement('div');
      ov.className = `ov ${region ? 'region' : 'text'}${state.activeId === anno.id ? ' on' : ''}`;
      ov.style.left = `${r.left}px`;
      ov.style.top = `${r.top}px`;
      ov.style.width = `${r.width}px`;
      ov.style.height = `${r.height}px`;
      if (region && i === 0) {
        const cnr = document.createElement('span');
        cnr.className = 'cnr';
        cnr.textContent = 'Region';
        ov.appendChild(cnr);
      }
      ov.addEventListener('click', () => focusAnnotation(anno.id));
      layer.appendChild(ov);
    });
  }
}

function syncControls(): void {
  $<HTMLButtonElement>('#pgPrev').disabled = state.pageNum <= 1;
  $<HTMLButtonElement>('#pgNext').disabled = state.pageNum >= state.numPages;
  $('#zVal').textContent = String(Math.round(state.zoom * 100));
}

function currentPageEl(): HTMLElement | null {
  return document.querySelector('.pdf-page');
}
function reRenderOverlays(): void {
  const layer = document.querySelector<HTMLElement>('.anno-layer');
  const pageEl = currentPageEl();
  if (layer && pageEl) renderOverlays(layer, { width: pageEl.clientWidth, height: pageEl.clientHeight });
}

/* ---- Text selection → anchor ---- */
function onTextSelect(): void {
  if (state.mode !== 'text') return;
  const sel = window.getSelection();
  const pageEl = currentPageEl();
  if (!sel || sel.isCollapsed || !sel.toString().trim() || !pageEl) {
    hideSeltool();
    return;
  }
  const range = sel.getRangeAt(0);
  if (!pageEl.contains(range.commonAncestorContainer)) {
    hideSeltool();
    return;
  }
  const box = pageEl.getBoundingClientRect();
  const clientRects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
  if (!clientRects.length) {
    hideSeltool();
    return;
  }
  const rects: PxRect[] = clientRects.map((r) => ({
    left: r.left - box.left,
    top: r.top - box.top,
    width: r.width,
    height: r.height,
  }));
  state.pending = {
    page: state.pageNum,
    quote: sel.toString().trim().replace(/\s+/g, ' '),
    rects,
    box: { width: box.width, height: box.height },
  };
  const last = clientRects[clientRects.length - 1]!;
  showSeltool(last.left + last.width / 2, last.top, [
    { icon: ICON.hl, label: 'Highlight', fn: () => void commitAnchor(false) },
    { icon: ICON.note, label: 'Note', fn: () => void commitAnchor(true) },
  ]);
}

interface SelAction {
  icon: string;
  label: string;
  fn: () => void;
}
function showSeltool(cx: number, top: number, actions: SelAction[]): void {
  const el = $('#seltool');
  el.innerHTML = actions.map((a, i) => `<button data-i="${i}">${a.icon}${a.label}</button>`).join('');
  $$('button', el).forEach((b, i) => {
    b.onclick = () => actions[i]!.fn();
  });
  el.classList.add('on');
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.max(8, Math.min(cx - w / 2, window.innerWidth - w - 8));
  let t = top - h - 8;
  if (t < 8) t = top + 20;
  el.style.left = `${left}px`;
  el.style.top = `${t}px`;
}
function hideSeltool(): void {
  $('#seltool').classList.remove('on');
}

/* ---- Region selection (drag a rectangle) ---- */
let regionStart: { x: number; y: number; box: DOMRect } | null = null;
function onRegionMouseDown(e: MouseEvent): void {
  if (state.mode !== 'region' || e.button !== 0) return;
  const pageEl = currentPageEl();
  if (!pageEl || !pageEl.contains(e.target as Node)) return;
  e.preventDefault();
  regionStart = { x: e.clientX, y: e.clientY, box: pageEl.getBoundingClientRect() };
  const rubber = document.createElement('div');
  rubber.className = 'rubber';
  rubber.id = 'rubber';
  pageEl.appendChild(rubber);
  updateRubber(e.clientX, e.clientY);
}
function rubberRect(cx: number, cy: number): PxRect {
  const b = regionStart!.box;
  return {
    left: Math.min(regionStart!.x, cx) - b.left,
    top: Math.min(regionStart!.y, cy) - b.top,
    width: Math.abs(cx - regionStart!.x),
    height: Math.abs(cy - regionStart!.y),
  };
}
function updateRubber(cx: number, cy: number): void {
  const rubber = document.getElementById('rubber');
  if (!rubber || !regionStart) return;
  const r = rubberRect(cx, cy);
  rubber.style.left = `${r.left}px`;
  rubber.style.top = `${r.top}px`;
  rubber.style.width = `${r.width}px`;
  rubber.style.height = `${r.height}px`;
}
function onRegionMouseMove(e: MouseEvent): void {
  if (regionStart) updateRubber(e.clientX, e.clientY);
}
function onRegionMouseUp(e: MouseEvent): void {
  if (!regionStart) return;
  const r = rubberRect(e.clientX, e.clientY);
  const b = regionStart.box;
  document.getElementById('rubber')?.remove();
  regionStart = null;
  if (r.width < 8 || r.height < 8) {
    hideSeltool();
    return;
  }
  state.pending = {
    page: state.pageNum,
    quote: '',
    rects: [r],
    box: { width: b.width, height: b.height },
  };
  showSeltool(b.left + r.left + r.width / 2, b.top + r.top, [
    { icon: ICON.region, label: 'Anchor region', fn: () => void commitAnchor(false) },
    { icon: ICON.note, label: 'Note', fn: () => void commitAnchor(true) },
  ]);
}

async function commitAnchor(withNote: boolean): Promise<void> {
  const p = state.pending;
  if (!p || !state.document || !state.documentId) return;
  const quote = state.mode === 'region' ? undefined : p.quote;
  const now = nowIso();
  const annotation: Annotation = {
    id: crypto.randomUUID(),
    projectId: state.document.projectId,
    documentId: state.documentId,
    anchor: createPdfAnchor(p.page, p.rects, p.box, quote),
    content: '',
    tags: [],
    status: 'draft',
    author: 'me',
    createdAt: now,
    updatedAt: now,
  };
  try {
    await sendRequest({ type: 'annotations/put', annotation });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not save annotation', true);
    return;
  }
  state.annotations.push(annotation);
  state.activeId = annotation.id;
  state.pending = null;
  hideSeltool();
  window.getSelection()?.removeAllRanges();
  await renderPage();
  renderRail();
  toast(quote ? 'Highlight anchored' : 'Region anchored');
  if (withNote) {
    $('#rail').classList.add('open');
    document.querySelector<HTMLTextAreaElement>(`.ac[data-id="${annotation.id}"] .note-ta`)?.focus();
  }
}

async function focusAnnotation(id: Id): Promise<void> {
  const anno = state.annotations.find((a) => a.id === id);
  if (!anno || anno.anchor.kind !== 'pdf') return;
  state.activeId = id;
  const page = anchorPage(anno.anchor);
  if (page !== state.pageNum) {
    state.pageNum = page;
    await renderPage();
  } else {
    reRenderOverlays();
  }
  renderRail();
  document.querySelector<HTMLElement>('.anno-layer .ov.on')?.scrollIntoView({
    block: 'center',
    behavior: 'smooth',
  });
  setTimeout(() => {
    state.activeId = null;
    reRenderOverlays();
  }, 1400);
}

/* ---- Annotations rail ---- */
function railData(): Annotation[] {
  return state.annotations.filter(
    (a) => a.anchor.kind === 'pdf' && (state.scope === 'all' || anchorPage(a.anchor) === state.pageNum),
  );
}
function renderRail(): void {
  $('#railN').textContent = `${state.annotations.length} on ${state.numPages} page${state.numPages === 1 ? '' : 's'}`;
  const list = $('#railList');
  const hint = `<div class="hint"><b>Anchoring.</b> Notes store <b>page + coordinate rects</b> plus the quoted text — the basis for re-anchoring after reload.</div>`;
  const rows = railData();
  if (rows.length === 0) {
    list.innerHTML = `${hint}<div class="rail-empty"><div class="et">No annotations ${state.scope === 'page' ? 'on this page' : 'yet'}</div><div class="ed">Select text or drag a region on the page to anchor a note.</div></div>`;
    return;
  }
  list.innerHTML = hint + rows.map(railCard).join('');
  rows.forEach((a) => {
    const card = document.querySelector<HTMLElement>(`.ac[data-id="${a.id}"]`);
    if (!card) return;
    card.querySelector('.loc')?.addEventListener('click', () => void focusAnnotation(a.id));
    const ta = card.querySelector<HTMLTextAreaElement>('.note-ta');
    ta?.addEventListener('input', () => scheduleNoteSave(a.id, ta.value));
    card.querySelector('[data-stat]')?.addEventListener('change', (e) => {
      void updateStatus(a.id, (e.target as HTMLSelectElement).value as AnnotationStatus);
    });
    card.querySelector('[data-del]')?.addEventListener('click', () => void deleteAnnotation(a.id));
  });
}
function railCard(a: Annotation): string {
  const pdf = a.anchor.kind === 'pdf' ? a.anchor : null;
  const page = pdf ? anchorPage(pdf) : 1;
  const region = pdf ? isRegionAnchor(pdf) : false;
  const quote = pdf ? anchorQuote(pdf) : undefined;
  const loc = region ? `p.${page} · Region` : `p.${page} · ¶ text`;
  return `<article class="ac${state.activeId === a.id ? ' active' : ''}" data-id="${a.id}">
    <div class="ac-top"><button class="loc">${region ? ICON.region : ICON.hl}<span>${esc(loc)}</span></button><span class="ac-kind">${region ? 'Region' : 'Text'}</span></div>
    ${quote ? `<div class="quote">${esc(quote)}</div>` : ''}
    <textarea class="note-ta" data-note placeholder="Add a note…">${esc(a.content)}</textarea>
    <div class="ac-foot">
      <select class="msel" data-stat aria-label="Review status">${ANNO_STATUSES.map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${ANNO_STATUS[s]}</option>`).join('')}</select>
      ${a.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
      <button class="ac-del" data-del aria-label="Delete annotation">${ICON.trash}</button>
    </div>
  </article>`;
}

const noteTimers = new Map<Id, ReturnType<typeof setTimeout>>();
function scheduleNoteSave(id: Id, content: string): void {
  clearTimeout(noteTimers.get(id));
  noteTimers.set(
    id,
    setTimeout(() => void saveAnnotation(id, { content }), 500),
  );
}
async function saveAnnotation(id: Id, patch: Partial<Annotation>): Promise<void> {
  const idx = state.annotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const updated: Annotation = { ...state.annotations[idx]!, ...patch, updatedAt: nowIso() };
  state.annotations[idx] = updated;
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Save failed', true);
  }
}
async function updateStatus(id: Id, status: AnnotationStatus): Promise<void> {
  await saveAnnotation(id, { status });
  toast(`Status · ${ANNO_STATUS[status]}`);
}
async function deleteAnnotation(id: Id): Promise<void> {
  try {
    await sendRequest({ type: 'annotations/delete', id });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Delete failed', true);
    return;
  }
  state.annotations = state.annotations.filter((a) => a.id !== id);
  await renderPage();
  renderRail();
  toast('Annotation removed');
}

/* ---- Mode + scope ---- */
function setMode(mode: 'text' | 'region'): void {
  state.mode = mode;
  $$('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.body.classList.toggle('mode-region', mode === 'region');
  hideSeltool();
}
function setScope(scope: 'page' | 'all'): void {
  state.scope = scope;
  $$('#railSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  renderRail();
}

/* ---- Toast ---- */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, error = false): void {
  const wrap = $('#toastWrap');
  wrap.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' toast--error' : '');
  t.innerHTML = `${error ? ICON.warn : ICON.check}<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 240);
    },
    error ? 3600 : 2400,
  );
}

/* ---- Controls ---- */
function setPage(n: number): void {
  const next = Math.min(state.numPages, Math.max(1, n));
  if (next === state.pageNum) return;
  state.pageNum = next;
  void renderPage();
}
function setZoom(delta: number): void {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((state.zoom + delta) * 100) / 100));
  if (next === state.zoom) return;
  state.zoom = next;
  void renderPage();
}

/* ---- Init ---- */
function init(): void {
  $('#back').onclick = () => {
    window.location.href = chrome.runtime.getURL('src/options/index.html');
  };
  $('#pgPrev').onclick = () => setPage(state.pageNum - 1);
  $('#pgNext').onclick = () => setPage(state.pageNum + 1);
  $('#zIn').onclick = () => setZoom(0.15);
  $('#zOut').onclick = () => setZoom(-0.15);
  $('#railToggle').onclick = () => $('#rail').classList.toggle('open');

  $$('#modeSeg button').forEach((b) => {
    b.onclick = () => setMode(b.dataset.mode === 'region' ? 'region' : 'text');
  });
  $$('#railSeg button').forEach((b) => {
    b.onclick = () => setScope(b.dataset.scope === 'all' ? 'all' : 'page');
  });

  // Text selection → anchor toolbar.
  document.addEventListener('mouseup', () => setTimeout(onTextSelect, 0));
  $('#pagewrap').addEventListener('scroll', hideSeltool);

  // Region drag → anchor a rectangle.
  $('#pagewrap').addEventListener('mousedown', onRegionMouseDown);
  document.addEventListener('mousemove', onRegionMouseMove);
  document.addEventListener('mouseup', onRegionMouseUp);

  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') setPage(state.pageNum + 1);
    else if (e.key === 'ArrowLeft') setPage(state.pageNum - 1);
    else if (e.key === 'Escape') hideSeltool();
  });

  renderRail();

  void loadDocument().catch((err: unknown) => {
    stageMessage('Could not open PDF', err instanceof Error ? err.message : String(err));
  });
}

document.addEventListener('DOMContentLoaded', init);
