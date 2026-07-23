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
import type { Document, Id } from '../core/model/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.75;

interface ViewerState {
  documentId: Id | null;
  document: Document | null;
  pdf: PDFDocumentProxy | null;
  pageNum: number;
  numPages: number;
  zoom: number;
}
const state: ViewerState = {
  documentId: null,
  document: null,
  pdf: null,
  pageNum: 1,
  numPages: 1,
  zoom: 1.25,
};

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
  await renderPage();
}

async function renderPage(): Promise<void> {
  if (!state.pdf) return;
  const page = await state.pdf.getPage(state.pageNum);
  const dpr = window.devicePixelRatio || 1;
  const cssViewport = page.getViewport({ scale: state.zoom });
  const renderViewport = page.getViewport({ scale: state.zoom * dpr });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);
  canvas.style.width = `${Math.floor(cssViewport.width)}px`;
  canvas.style.height = `${Math.floor(cssViewport.height)}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const pageEl = document.createElement('div');
  pageEl.className = 'pdf-page';
  pageEl.dataset.page = String(state.pageNum);
  pageEl.style.width = `${Math.floor(cssViewport.width)}px`;
  pageEl.style.height = `${Math.floor(cssViewport.height)}px`;
  pageEl.appendChild(canvas);
  $('#pagescale').replaceChildren(pageEl);

  await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

  $('#pgCur').textContent = String(state.pageNum);
  $('#pagewrap').scrollTop = 0;
  syncControls();
}

function syncControls(): void {
  $<HTMLButtonElement>('#pgPrev').disabled = state.pageNum <= 1;
  $<HTMLButtonElement>('#pgNext').disabled = state.pageNum >= state.numPages;
  $('#zVal').textContent = String(Math.round(state.zoom * 100));
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

  document.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') setPage(state.pageNum + 1);
    else if (e.key === 'ArrowLeft') setPage(state.pageNum - 1);
  });

  // Rail placeholder until M3 wires annotations.
  $('#railList').innerHTML = `<div class="hint"><b>Anchoring.</b> Select text or drag a region on the page to attach a note. Anchors store page + coordinate rectangles and survive zoom.</div>`;

  void loadDocument().catch((err: unknown) => {
    stageMessage('Could not open PDF', err instanceof Error ? err.message : String(err));
  });
}

document.addEventListener('DOMContentLoaded', init);
