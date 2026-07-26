/**
 * Side panel entry point. Wires the ported UI to the service worker over the
 * typed messaging layer, and to the active tab for capture.
 */
import './panel.css';
import { sendRequest } from '../adapters/chrome/messaging';
import { scanActiveTab, captureActiveTab } from '../adapters/chrome/capture';
import { buildCaptureInput } from '../adapters/chrome/page-scan';
import { getActiveProjectId, setActiveProjectId } from '../adapters/chrome/active-project';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../core/model/workflow';
import type {
  Annotation,
  AnnotationStatus,
  CitationStyle,
  Document,
  Id,
  Project,
  TextQuoteSelector,
} from '../core/model/types';
import { templateFor } from '../core/citation/styles';
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

interface State {
  projects: Project[];
  activeProjectId: string | null;
  documents: Document[];
  styles: CitationStyle[];
  filter: ListFilter;
  preview: CaptureInput | null;
  /** Id of the most recently filed reference — drives the cite buttons. */
  filedReferenceId: string | null;
  /** URL of the most recently filed page — so "Filed ✓" tracks the *page*, not
   *  the session. Without this the button stuck on "Filed ✓" forever and only
   *  one page could be filed per panel open. */
  filedUrl: string | null;
  /** Web annotations anchored to `preview.url`, plus the document they belong
   *  to (created lazily by the first annotation on a page). */
  pageAnnotations: Annotation[];
  pageDocumentId: string | null;
  /** Ids the content script reported it could actually place on the current
   *  load of the page. Empty means "no report yet" — render everything
   *  normally rather than presuming every note is lost. */
  resolvedIds: Set<string>;
}

const state: State = {
  projects: [],
  activeProjectId: null,
  documents: [],
  styles: [],
  filter: { search: '', status: 'all' },
  preview: null,
  filedReferenceId: null,
  filedUrl: null,
  pageAnnotations: [],
  pageDocumentId: null,
  resolvedIds: new Set(),
};

const ANNO_STATUS: Record<AnnotationStatus, string> = {
  draft: 'Draft',
  accepted: 'Accepted',
  rejected: 'Rejected',
  includedInReport: 'In report',
};
const ANNO_STATUSES = Object.keys(ANNO_STATUS) as AnnotationStatus[];

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const nowIso = (): string => new Date().toISOString();

function activeProject(): Project | undefined {
  return state.projects.find((p) => p.id === state.activeProjectId);
}

/**
 * The style the panel cites with. Mirrors the dashboard's `activeStyle`: the
 * project's configured default, else the first style. The panel used to hardcode
 * APA, silently ignoring whatever style the user had set up in the dashboard.
 */
function activeStyle(): CitationStyle | undefined {
  return state.styles.find((s) => s.id === activeProject()?.defaultCitationStyleId) ?? state.styles[0];
}

function citeArgs(): { template: string; styleId: Id | undefined } {
  const style = activeStyle();
  return { template: templateFor(style?.baseStyleId ?? 'apa'), styleId: style?.id };
}

function styleLabel(): string {
  return activeStyle()?.name ?? 'APA';
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

// The active project is the one canonical value shared with the dashboard (and
// the injected annotator) via chrome.storage.local — see
// src/adapters/chrome/active-project.ts.
async function restoreActiveProject(): Promise<void> {
  const id = await getActiveProjectId();
  if (id && state.projects.some((p) => p.id === id)) state.activeProjectId = id;
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

async function loadStyles(): Promise<void> {
  state.styles = await sendRequest({ type: 'citationStyles/list' });
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

/**
 * Load the web annotations anchored to the currently previewed page. Keyed on
 * `preview.url`, so it must run after `loadPreview()`. `resolvedIds` always
 * resets here: it describes what the content script placed on *this* load of
 * *this* page, and a stale set from the previous page would wrongly mark
 * fresh annotations as unplaced until a new `annotator/resolved` report
 * arrives.
 */
async function loadPageAnnotations(): Promise<void> {
  const url = state.preview?.url;
  state.resolvedIds = new Set();
  if (!state.activeProjectId || !url) {
    state.pageAnnotations = [];
    state.pageDocumentId = null;
    return;
  }
  const { documentId, annotations } = await sendRequest({
    type: 'web/annotationsForUrl',
    projectId: state.activeProjectId,
    url,
  });
  state.pageDocumentId = documentId;
  state.pageAnnotations = annotations;
}

/**
 * Re-scan the active tab and repaint the capture card. Wired to tab-activation,
 * tab-load and window-focus events so the card reflects the page the user is
 * actually looking at — the panel used to scan once at open and then file the
 * wrong page after any tab switch.
 */
async function refreshPreview(): Promise<void> {
  await loadPreview();
  await loadPageAnnotations();
  renderCaptureCard();
  renderOnPageCard();
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function renderHeader(): void {
  const project = activeProject();
  $('activeName').textContent = project?.name ?? '—';
  $('activeSub').textContent = project
    ? `${state.documents.length} sources · ${styleLabel()}`
    : '';
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
  // "Filed ✓" tracks the previewed page, so switching to a new page re-enables
  // filing instead of leaving the button stuck from the previous capture.
  const alreadyFiled = state.filedUrl !== null && state.filedUrl === state.preview.url;
  fileBtn.disabled = alreadyFiled;
  fileBtn.textContent = alreadyFiled
    ? 'Filed ✓'
    : `File into “${activeProject()?.name ?? 'project'}”`;

  $<HTMLButtonElement>('copyInText').disabled = state.filedReferenceId === null;
  $<HTMLButtonElement>('copyBiblio').disabled = state.filedReferenceId === null;
}

// --------------------------------------------------------------------------
// On this page — web annotations for the previewed URL
// --------------------------------------------------------------------------

function isCapturablePreview(): boolean {
  return state.preview !== null && /^https?:/i.test(state.preview.url);
}

function annotationQuote(a: Annotation): string {
  if (a.anchor.kind !== 'web') return '';
  const selector = a.anchor.selectors.find(
    (s): s is TextQuoteSelector => s.type === 'textQuote',
  );
  return selector?.exact ?? '';
}

function makeOnPageCard(a: Annotation): HTMLElement {
  const card = document.createElement('article');
  card.className = 'onpage-note';
  card.dataset.id = a.id;
  card.dataset.odId = `onpage-note-${a.id}`;

  const quote = annotationQuote(a);
  if (quote) {
    const q = document.createElement('div');
    q.className = 'onpage-note__quote';
    q.textContent = quote; // never innerHTML — the quote is page content, not ours.
    card.append(q);
  }

  const ta = document.createElement('textarea');
  ta.className = 'onpage-note__ta';
  ta.placeholder = 'Add a note…';
  ta.value = a.content; // .value, not innerHTML — same reason.
  ta.addEventListener('input', () => scheduleNoteSave(a.id, ta.value));
  card.append(ta);

  const foot = document.createElement('div');
  foot.className = 'onpage-note__foot';

  const select = document.createElement('select');
  select.className = 'onpage-note__status';
  select.setAttribute('aria-label', 'Review status');
  for (const status of ANNO_STATUSES) {
    const opt = document.createElement('option');
    opt.value = status;
    opt.textContent = ANNO_STATUS[status];
    opt.selected = status === a.status;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    void updatePageAnnotationStatus(a.id, select.value as AnnotationStatus);
  });
  foot.append(select);

  const jumpBtn = document.createElement('button');
  jumpBtn.type = 'button';
  jumpBtn.className = 'btn onpage-note__jump';
  jumpBtn.textContent = 'Jump to';
  jumpBtn.addEventListener('click', () => {
    // Panel → SW → active tab's content script; the panel has no direct
    // tabs.sendMessage access to an injected page context.
    chrome.runtime.sendMessage({ control: 'annotator/jump', id: a.id }).catch(() => {});
  });
  foot.append(jumpBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'onpage-note__del';
  delBtn.setAttribute('aria-label', 'Delete annotation');
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => void deletePageAnnotation(a.id));
  foot.append(delBtn);

  card.append(foot);
  return card;
}

interface FocusedNoteEdit {
  id: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/** A re-render (e.g. from a second highlight arriving via `annotator/changed`)
 *  rebuilds every card from scratch, which would otherwise yank focus and
 *  caret position out from under a note the user is mid-edit in. Capture the
 *  focused textarea's owning annotation id + selection before the rebuild so
 *  it can be restored after. */
function captureFocusedNoteEdit(): FocusedNoteEdit | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement) || !active.classList.contains('onpage-note__ta')) {
    return null;
  }
  const card = active.closest<HTMLElement>('.onpage-note');
  const id = card?.dataset.id;
  if (!id) return null;
  return { id, selectionStart: active.selectionStart, selectionEnd: active.selectionEnd };
}

function restoreFocusedNoteEdit(focused: FocusedNoteEdit | null): void {
  if (!focused) return;
  const card = document.querySelector<HTMLElement>(
    `.onpage-note[data-id="${CSS.escape(focused.id)}"]`,
  );
  const ta = card?.querySelector<HTMLTextAreaElement>('.onpage-note__ta');
  if (!ta) return;
  ta.focus();
  if (focused.selectionStart !== null && focused.selectionEnd !== null) {
    ta.setSelectionRange(focused.selectionStart, focused.selectionEnd);
  }
}

function renderOnPageCard(): void {
  const section = $('onPageCard');
  const capturable = isCapturablePreview();
  section.hidden = !capturable;
  if (!capturable) return;

  const list = $('onPageList');
  const annotations = state.pageAnnotations;
  const focused = captureFocusedNoteEdit();

  if (annotations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'onpage-empty';
    empty.textContent = 'No notes on this page yet — select text to highlight or annotate it.';
    list.replaceChildren(empty);
    return;
  }

  // Only split placed/lost once the content script has actually reported back
  // for this page — an empty set just means no report has arrived yet, not
  // that every annotation failed to place.
  const splitByResolution = state.resolvedIds.size > 0;
  const placed = splitByResolution
    ? annotations.filter((a) => state.resolvedIds.has(a.id))
    : annotations;
  const lost = splitByResolution ? annotations.filter((a) => !state.resolvedIds.has(a.id)) : [];

  const nodes: HTMLElement[] = placed.map(makeOnPageCard);
  if (lost.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'onpage-lost__heading';
    heading.textContent = "Couldn't place on this page";
    nodes.push(heading, ...lost.map(makeOnPageCard));
  }
  list.replaceChildren(...nodes);
  restoreFocusedNoteEdit(focused);
}

const pageNoteTimers = new Map<Id, ReturnType<typeof setTimeout>>();
function scheduleNoteSave(id: Id, content: string): void {
  clearTimeout(pageNoteTimers.get(id));
  pageNoteTimers.set(
    id,
    setTimeout(() => void savePageAnnotationContent(id, content), 500),
  );
}

async function savePageAnnotationContent(id: Id, content: string): Promise<void> {
  const idx = state.pageAnnotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const updated: Annotation = { ...state.pageAnnotations[idx]!, content, updatedAt: nowIso() };
  state.pageAnnotations[idx] = updated;
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Save failed', true);
  }
}

async function updatePageAnnotationStatus(id: Id, status: AnnotationStatus): Promise<void> {
  const idx = state.pageAnnotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const updated: Annotation = { ...state.pageAnnotations[idx]!, status, updatedAt: nowIso() };
  state.pageAnnotations[idx] = updated;
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
    toast(`Status · ${ANNO_STATUS[status]}`);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t change status', true);
  }
}

async function deletePageAnnotation(id: Id): Promise<void> {
  try {
    await sendRequest({ type: 'annotations/delete', id });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Delete failed', true);
    return;
  }
  state.pageAnnotations = state.pageAnnotations.filter((a) => a.id !== id);
  state.resolvedIds.delete(id);
  clearTimeout(pageNoteTimers.get(id));
  pageNoteTimers.delete(id);
  renderOnPageCard();
  toast('Annotation removed');
}

/** Scroll a note card into view and flash it — mirrors the content script's
 *  own overlay flash, so a click anywhere in the loop lands somewhere visible. */
function focusOnPageCard(id: string): void {
  const card = document.querySelector<HTMLElement>(
    `.onpage-note[data-id="${CSS.escape(id)}"]`,
  );
  if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1200);
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
  renderOnPageCard();
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
    state.filedUrl = state.preview?.url ?? null;
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

// --------------------------------------------------------------------------
// Project switcher — the header button was inert markup, pinning the panel to
// an arbitrary projects[0]. Captures from the panel could silently land in a
// project the user was not looking at, with no way to change it.
// --------------------------------------------------------------------------

function closeProjectMenu(): void {
  const menu = document.getElementById('projectMenu');
  if (!menu) return;
  menu.remove();
  $('switchBtn').setAttribute('aria-expanded', 'false');
}

function openProjectMenu(anchor: HTMLElement): void {
  // Toggle: a second click on the button closes an open menu.
  if (document.getElementById('projectMenu')) {
    closeProjectMenu();
    return;
  }
  closeStatusMenu();

  const menu = document.createElement('div');
  menu.className = 'smenu';
  menu.id = 'projectMenu';
  menu.setAttribute('role', 'menu');

  for (const project of state.projects) {
    const item = document.createElement('button');
    item.className = 'smenu__item' + (project.id === state.activeProjectId ? ' is-current' : '');
    item.setAttribute('role', 'menuitem');
    const label = document.createElement('span');
    label.className = 'smenu__label';
    label.textContent = project.name;
    item.append(label);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeProjectMenu();
      if (project.id !== state.activeProjectId) void switchProject(project.id);
    });
    menu.append(item);
  }

  const create = document.createElement('button');
  create.className = 'smenu__item smenu__item--create';
  create.setAttribute('role', 'menuitem');
  create.textContent = '+ New project';
  create.addEventListener('click', (e) => {
    e.stopPropagation();
    closeProjectMenu();
    void createProject();
  });
  menu.append(create);

  document.body.append(menu);

  // The header is fixed, so a static position under the button is enough — no
  // scroll repositioning like the status menu needs.
  const box = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${box.bottom + 6}px`;
  anchor.setAttribute('aria-expanded', 'true');
}

async function switchProject(projectId: string): Promise<void> {
  state.activeProjectId = projectId;
  // A new project means the previous capture context no longer applies.
  state.filedReferenceId = null;
  state.filedUrl = null;
  await setActiveProjectId(projectId);
  await loadDocuments();
  render();
  await refreshPreview();
  toast(`Switched to “${activeProject()?.name ?? 'project'}”`);
}

async function createProject(): Promise<void> {
  const name = `Project ${state.projects.length + 1}`;
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    sections: ['Literature', 'Methods', 'Data', 'Report'],
    members: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    await sendRequest({ type: 'projects/put', project });
    state.projects = await sendRequest({ type: 'projects/list' });
    await switchProject(project.id);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t create project', true);
  }
}

async function setStatus(doc: Document, status: DocumentStatus): Promise<void> {
  const updated: Document = { ...doc, status, updatedAt: nowIso() };
  try {
    await sendRequest({ type: 'documents/put', document: updated });
    await loadDocuments();
    render();
    toast(`Moved to “${statusLabel(status)}”`);
  } catch (err) {
    // Without this the write rejected unhandled: the list never updated and the
    // user got no signal that the status change was lost.
    toast(err instanceof Error ? err.message : 'Couldn’t change status', true);
  }
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
      ...citeArgs(),
    });
    await copyToClipboard(out.inText, 'In-text citation');
  } catch {
    toast('No citation available for this source', true);
  }
}

async function copyCaptureInText(): Promise<void> {
  if (!state.filedReferenceId) return;
  try {
    const out = await sendRequest({
      type: 'citations/reference',
      referenceId: state.filedReferenceId,
      ...citeArgs(),
    });
    await copyToClipboard(out.inText, 'In-text citation');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t build citation', true);
  }
}

async function copyCaptureBiblio(): Promise<void> {
  if (!state.filedReferenceId) return;
  try {
    const out = await sendRequest({
      type: 'citations/reference',
      referenceId: state.filedReferenceId,
      ...citeArgs(),
    });
    await copyToClipboard(out.bibliography, 'Bibliography entry');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t build bibliography entry', true);
  }
}

async function copyProjectBibliography(): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const bib = await sendRequest({
      type: 'citations/bibliography',
      projectId: state.activeProjectId,
      ...citeArgs(),
    });
    if (!bib) {
      toast('No sources to compile yet');
      return;
    }
    await copyToClipboard(bib, 'Bibliography');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t compile bibliography', true);
  }
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
  $('annotateBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ control: 'annotator/activate' }).catch(() => {});
  });
  $('switchBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectMenu($('switchBtn'));
  });

  // The popovers are light: anything else the user does dismisses them.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('#statusMenu')) closeStatusMenu();
    if (!t.closest('#projectMenu') && !t.closest('#switchBtn')) closeProjectMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeStatusMenu();
      closeProjectMenu();
    }
  });

  // Keep the capture card pinned to the page the user is actually looking at.
  chrome.tabs.onActivated.addListener(() => void refreshPreview());
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    if (info.status === 'complete' && tab.active) void refreshPreview();
  });
  window.addEventListener('focus', () => void refreshPreview());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPreview();
  });

  // The annotator (content script / SW) is a separate extension surface —
  // these are `control` messages, not the typed request/response pairs
  // `sendRequest` uses, so they're handled directly here rather than through
  // the router.
  chrome.runtime.onMessage.addListener(
    (message: { control?: string; id?: string; url?: string; resolvedIds?: string[] }) => {
      if (message?.control === 'annotator/changed') {
        void (async () => {
          await loadPageAnnotations();
          renderOnPageCard();
        })();
      } else if (message?.control === 'annotator/resolved') {
        if (message.url && message.url === state.preview?.url) {
          state.resolvedIds = new Set(message.resolvedIds ?? []);
          renderOnPageCard();
        }
      } else if (message?.control === 'annotator/focus' && message.id) {
        focusOnPageCard(message.id);
      }
    },
  );

  await ensureSeedProject();
  await restoreActiveProject();
  await loadStyles();
  await loadDocuments();
  render();
  await loadPreview();
  await loadPageAnnotations();
  renderCaptureCard();
  renderOnPageCard();
}

document.addEventListener('DOMContentLoaded', () => void init());
