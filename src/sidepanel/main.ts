/**
 * Side panel entry point. Wires the ported UI to the service worker over the
 * typed messaging layer, and to the active tab for capture.
 */
import './panel.css';
import { sendRequest } from '../adapters/chrome/messaging';
import { scanActiveTab, captureActiveTab } from '../adapters/chrome/capture';
import { buildCaptureInput } from '../adapters/chrome/page-scan';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../core/model/workflow';
import type { Document, Project } from '../core/model/types';
import type { CaptureInput } from '../core/usecases/capture';
import {
  STATUS_META,
  statusLabel,
  statusCounts,
  filterDocuments,
  groupByStatus,
  computeProgress,
  type ListFilter,
} from './view-model';

const DEFAULT_TEMPLATE = 'apa';

interface State {
  projects: Project[];
  activeProjectId: string | null;
  documents: Document[];
  filter: ListFilter;
  preview: CaptureInput | null;
  filedReferenceId: string | null;
}

const state: State = {
  projects: [],
  activeProjectId: null,
  documents: [],
  filter: { search: '', status: 'all' },
  preview: null,
  filedReferenceId: null,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const nowIso = (): string => new Date().toISOString();

function activeProject(): Project | undefined {
  return state.projects.find((p) => p.id === state.activeProjectId);
}

// --------------------------------------------------------------------------
// Data loading
// --------------------------------------------------------------------------

async function ensureSeedProject(): Promise<void> {
  state.projects = await sendRequest({ type: 'projects/list' });
  if (state.projects.length === 0) {
    const project: Project = {
      id: crypto.randomUUID(),
      name: 'My Research',
      sections: ['Literature', 'Methods', 'Data', 'Report'],
      members: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await sendRequest({ type: 'projects/put', project });
    state.projects = [project];
  }
  state.activeProjectId ??= state.projects[0]?.id ?? null;
}

async function loadDocuments(): Promise<void> {
  if (!state.activeProjectId) {
    state.documents = [];
    return;
  }
  state.documents = await sendRequest({
    type: 'documents/listByProject',
    projectId: state.activeProjectId,
  });
}

async function loadPreview(): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const scan = await scanActiveTab();
    state.preview = buildCaptureInput(scan, state.activeProjectId);
  } catch {
    state.preview = null;
  }
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function renderHeader(): void {
  const project = activeProject();
  $('activeName').textContent = project?.name ?? '—';
  $('activeSub').textContent = project ? `${state.documents.length} sources · APA` : '';
}

function renderCaptureCard(): void {
  const type = $('capType');
  const title = $('capTitle');
  const meta = $('capMeta');
  const fileBtn = $<HTMLButtonElement>('fileBtn');

  if (!state.preview) {
    type.textContent = 'No page metadata';
    title.textContent = 'Open an article to capture it';
    meta.textContent = '';
    fileBtn.disabled = true;
    return;
  }

  const m = state.preview.metadata;
  type.textContent = state.preview.type === 'article' ? 'Article · metadata extracted' : 'Web page';
  title.textContent = m.title ?? state.preview.url;
  meta.textContent = [m.authors?.join(', '), m.year, m.journal, m.doi ? `doi:${m.doi}` : null]
    .filter(Boolean)
    .join(' · ');
  fileBtn.disabled = state.filedReferenceId !== null;
  fileBtn.textContent = state.filedReferenceId
    ? 'Filed ✓'
    : `File into “${activeProject()?.name ?? 'project'}”`;

  $<HTMLButtonElement>('copyInText').disabled = state.filedReferenceId === null;
  $<HTMLButtonElement>('copyBiblio').disabled = state.filedReferenceId === null;
}

function statusColor(status: DocumentStatus): string {
  return `var(--s-${status})`;
}

function renderSegmented(): void {
  const counts = statusCounts(state.documents);
  const options: Array<{ id: DocumentStatus | 'all'; label: string }> = [
    { id: 'all', label: 'All' },
    ...STATUS_META.map((s) => ({ id: s.id, label: s.label.replace(' in output', '') })),
  ];
  const seg = $('segmented');
  seg.replaceChildren(
    ...options.map((o) => {
      const b = document.createElement('button');
      b.className = 'seg';
      b.setAttribute('aria-pressed', String(state.filter.status === o.id));
      b.innerHTML = `${o.label} <span class="n">${counts[o.id] ?? 0}</span>`;
      b.addEventListener('click', () => {
        state.filter.status = o.id;
        render();
      });
      return b;
    }),
  );
}

function makeDocRow(doc: Document): HTMLElement {
  const row = document.createElement('div');
  row.className = 'doc';
  row.dataset.odId = `doc-${doc.id}`;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  const m = doc.metadata;
  const metaLine = [m.authors?.[0], m.year, m.journal].filter(Boolean).join(' · ');

  const title = document.createElement('div');
  title.className = 'doc__title';
  title.textContent = m.title ?? doc.url;

  const metaEl = document.createElement('div');
  metaEl.className = 'doc__meta';
  metaEl.textContent = metaLine;

  const foot = document.createElement('div');
  foot.className = 'doc__foot';

  const statusBtn = document.createElement('button');
  statusBtn.className = 'status-btn';
  statusBtn.title = 'Change status';
  statusBtn.setAttribute('aria-haspopup', 'menu');
  statusBtn.dataset.odId = `status-${doc.id}`;
  statusBtn.innerHTML = `<span class="sdot" style="background:${statusColor(doc.status)}"></span>${statusLabel(doc.status)}`;
  statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openStatusMenu(statusBtn, doc);
  });
  foot.append(statusBtn);

  if (doc.section) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = doc.section;
    foot.append(chip);
  }

  row.append(title, metaEl, foot);
  row.addEventListener('click', () => void copyDocCitation(doc));
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void copyDocCitation(doc);
    }
  });
  return row;
}

function renderList(): void {
  const root = $('listRoot');
  const visible = filterDocuments(state.documents, state.filter);

  if (state.documents.length === 0) {
    root.innerHTML = `<div class="empty"><div class="empty__t">No sources filed yet</div>
      <div class="empty__d">Open a paper, then use “File into project” to start this reading list.</div></div>`;
    return;
  }
  if (visible.length === 0) {
    root.innerHTML = `<div class="empty"><div class="empty__t">Nothing matches</div>
      <div class="empty__d">Clear the search or status filter.</div></div>`;
    return;
  }

  root.replaceChildren(
    ...groupByStatus(visible).map((group) => {
      const g = document.createElement('div');
      g.className = 'group';
      const head = document.createElement('div');
      head.className = 'group__head';
      head.innerHTML = `<span class="group__dot" style="background:${statusColor(group.status)}"></span>
        <span class="group__name">${group.label}</span>
        <span class="group__count">${group.documents.length}</span>`;
      g.append(head, ...group.documents.map(makeDocRow));
      return g;
    }),
  );
}

function renderProgress(): void {
  const progress = computeProgress(state.documents);
  $('totalCount').textContent = progress.total ? `${progress.total} sources` : '';
  $('progVal').textContent = progress.total
    ? `${progress.reviewed}/${progress.total} analysed`
    : 'no sources';

  const counts = statusCounts(state.documents);
  const bar = $('progBar');
  bar.replaceChildren(
    ...STATUS_META.map((s) => {
      const seg = document.createElement('div');
      seg.className = 'prog__seg';
      seg.style.background = statusColor(s.id);
      seg.style.flexGrow = String(counts[s.id]);
      seg.style.opacity = counts[s.id] ? '1' : '0';
      return seg;
    }),
  );
}

function render(): void {
  renderHeader();
  renderCaptureCard();
  renderSegmented();
  renderList();
  renderProgress();
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

async function fileCurrentPage(): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const result = await captureActiveTab(state.activeProjectId);
    state.filedReferenceId = result.reference.id;
    await loadDocuments();
    render();
    toast(result.deduped ? 'Already filed — reused existing source' : 'Filed into project');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Capture failed', true);
  }
}

/**
 * Pick a status directly. Click-cycling only ever moved a source forward, so a
 * mis-click could not be undone from the panel at all — the pipeline runs one
 * way. The menu is the whole pipeline, current position marked.
 */
let statusMenuAnchor: HTMLElement | null = null;

/**
 * Keep the menu on its button. It is `position: fixed`, so it does not scroll
 * with the list; repositioning — rather than closing on scroll — matters
 * because a late layout shift fires a scroll event that would otherwise snatch
 * the menu away mid-click.
 */
function positionStatusMenu(): void {
  const menu = document.getElementById('statusMenu');
  if (!menu || !statusMenuAnchor) return;
  const box = statusMenuAnchor.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight) {
    closeStatusMenu();
    return;
  }
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  const below = window.innerHeight - box.bottom;
  menu.style.top =
    below < menu.offsetHeight + 12
      ? `${box.top - menu.offsetHeight - 6}px`
      : `${box.bottom + 6}px`;
}

function openStatusMenu(anchor: HTMLElement, doc: Document): void {
  closeStatusMenu();
  const menu = document.createElement('div');
  menu.className = 'smenu';
  menu.id = 'statusMenu';
  menu.setAttribute('role', 'menu');

  for (const status of DOCUMENT_STATUSES) {
    const item = document.createElement('button');
    item.className = 'smenu__item' + (status === doc.status ? ' is-current' : '');
    item.setAttribute('role', 'menuitem');
    item.dataset.status = status;
    item.innerHTML =
      `<span class="sdot" style="background:${statusColor(status)}"></span>` +
      `<span class="smenu__label">${statusLabel(status)}</span>`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeStatusMenu();
      if (status !== doc.status) void setStatus(doc, status);
    });
    menu.append(item);
  }

  document.body.append(menu);
  statusMenuAnchor = anchor;
  positionStatusMenu();
  $('scrollBody').addEventListener('scroll', positionStatusMenu, { passive: true });

  // A menu you can open with the keyboard but not walk with it is not a menu.
  const items = [...menu.querySelectorAll<HTMLButtonElement>('.smenu__item')];
  items.forEach((item, index) => {
    item.tabIndex = index === 0 ? 0 : -1;
    item.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (step !== 0) {
        e.preventDefault();
        items[(index + step + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === 'Tab') {
        // Leaving the menu closes it, rather than stranding it over the list.
        closeStatusMenu();
      }
    });
  });
  // Open on the current status, so ↓ from there is the next stage.
  (items.find((i) => i.classList.contains('is-current')) ?? items[0])?.focus();
}

function closeStatusMenu(): void {
  const menu = document.getElementById('statusMenu');
  if (!menu) return;
  menu.remove();
  statusMenuAnchor = null;
  $('scrollBody').removeEventListener('scroll', positionStatusMenu);
}

async function setStatus(doc: Document, status: DocumentStatus): Promise<void> {
  const updated: Document = { ...doc, status, updatedAt: nowIso() };
  await sendRequest({ type: 'documents/put', document: updated });
  await loadDocuments();
  render();
  toast(`Moved to “${statusLabel(status)}”`);
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`);
  } catch {
    toast('Couldn’t copy — clipboard blocked', true);
  }
}

async function copyDocCitation(doc: Document): Promise<void> {
  try {
    const out = await sendRequest({
      type: 'citations/document',
      documentId: doc.id,
      template: DEFAULT_TEMPLATE,
    });
    await copyToClipboard(out.inText, 'In-text citation');
  } catch {
    toast('No citation available for this source', true);
  }
}

async function copyCaptureInText(): Promise<void> {
  if (!state.filedReferenceId) return;
  const out = await sendRequest({
    type: 'citations/reference',
    referenceId: state.filedReferenceId,
    template: DEFAULT_TEMPLATE,
  });
  await copyToClipboard(out.inText, 'In-text citation');
}

async function copyCaptureBiblio(): Promise<void> {
  if (!state.filedReferenceId) return;
  const out = await sendRequest({
    type: 'citations/reference',
    referenceId: state.filedReferenceId,
    template: DEFAULT_TEMPLATE,
  });
  await copyToClipboard(out.bibliography, 'Bibliography entry');
}

async function copyProjectBibliography(): Promise<void> {
  if (!state.activeProjectId) return;
  const bib = await sendRequest({
    type: 'citations/bibliography',
    projectId: state.activeProjectId,
    template: DEFAULT_TEMPLATE,
  });
  if (!bib) {
    toast('No sources to compile yet');
    return;
  }
  await copyToClipboard(bib, 'Bibliography');
}

// --------------------------------------------------------------------------
// Toast
// --------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, isError = false): void {
  const wrap = $('toastWrap');
  wrap.replaceChildren();
  const t = document.createElement('div');
  t.className = `toast${isError ? ' toast--error' : ''}`;
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.textContent = message;
  wrap.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), isError ? 3600 : 2600);
}

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------

async function init(): Promise<void> {
  $('searchInput').addEventListener('input', (e) => {
    state.filter.search = (e.target as HTMLInputElement).value;
    renderList();
  });
  $('fileBtn').addEventListener('click', () => void fileCurrentPage());
  $('copyInText').addEventListener('click', () => void copyCaptureInText());
  $('copyBiblio').addEventListener('click', () => void copyCaptureBiblio());
  $('bibBtn').addEventListener('click', () => void copyProjectBibliography());

  // The status menu is a light popover: anything else the user does dismisses it.
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#statusMenu')) closeStatusMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStatusMenu();
  });

  await ensureSeedProject();
  await loadDocuments();
  render();
  await loadPreview();
  renderCaptureCard();
}

document.addEventListener('DOMContentLoaded', () => void init());
