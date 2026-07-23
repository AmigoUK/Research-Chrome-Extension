/**
 * Dashboard controller (options page). Vanilla TS, mirroring the side panel:
 * a single `state` object + full-redraw `render()`, talking to the service
 * worker exclusively through the typed `sendRequest` messaging layer.
 *
 * M1 delivers the app-shell: sidebar with project switcher + nav, a view router,
 * the mobile drawer, and the credit footer. Views (Overview/Kanban, Documents,
 * References, Annotations, Citation styles) are scaffolded here and filled in by
 * later milestones.
 */
import './dashboard.css';
import { sendRequest } from '../adapters/chrome/messaging';
import type { Project, Document, Annotation, Reference, CitationStyle, Id } from '../core/model/types';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../core/model/workflow';
import { templateFor } from '../core/citation/styles';
import {
  computeProgress,
  filterDocuments,
  statusCounts,
  type ListFilter,
} from '../sidepanel/view-model';
import { ROUTE_TITLES, STATUS_META, isRoute, statusDot, statusLabel, type Route } from './view-model';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(sel)];
const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );

/* ---- Icons (inline SVG paths) ---- */
const ICON = {
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
};

interface NavDef {
  id: Route;
  label: string;
  icon: string;
  /** Badge count for this route, or undefined for no badge. */
  count: () => number | undefined;
}
const NAV: NavDef[] = [
  {
    id: 'overview',
    label: 'Overview',
    count: () => undefined,
    icon: '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
  },
  {
    id: 'documents',
    label: 'Documents',
    count: () => state.documents.length,
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  },
  {
    id: 'annotations',
    label: 'Annotations',
    count: () => state.annotations.length,
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  },
  {
    id: 'references',
    label: 'References',
    count: () => (state.references.length > 0 ? state.references.length : undefined),
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  },
  {
    id: 'styles',
    label: 'Citation styles',
    count: () => (state.styles.length > 0 ? state.styles.length : undefined),
    icon: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  },
];

/* ---- State ---- */
interface DashState {
  projects: Project[];
  activeProjectId: Id | null;
  documents: Document[];
  annotations: Annotation[];
  references: Reference[];
  styles: CitationStyle[];
  route: Route;
  flash: Id | null;
  drag: Id | null;
  docFilter: ListFilter;
}
const state: DashState = {
  projects: [],
  activeProjectId: null,
  documents: [],
  annotations: [],
  references: [],
  styles: [],
  route: 'overview',
  flash: null,
  drag: null,
  docFilter: { search: '', status: 'all' },
};

const activeProject = (): Project | undefined =>
  state.projects.find((p) => p.id === state.activeProjectId);
const docById = (id: Id): Document | undefined => state.documents.find((d) => d.id === id);
const activeStyle = (): CitationStyle | undefined =>
  state.styles.find((s) => s.id === activeProject()?.defaultCitationStyleId) ?? state.styles[0];
const notesFor = (documentId: Id): number =>
  state.annotations.filter((a) => a.documentId === documentId).length;

function firstSurname(name: string): string {
  return name.split(',')[0]?.trim() || name;
}
function authorLabel(authors?: string[]): string {
  const a = (authors ?? []).map(firstSurname);
  if (a.length === 0) return 'Unknown author';
  if (a.length === 1) return a[0]!;
  if (a.length === 2) return `${a[0]} & ${a[1]}`;
  return `${a[0]} et al.`;
}

/* ---- Data ---- */
function nowIso(): string {
  return new Date().toISOString();
}
function makeProject(name: string): Project {
  const now = nowIso();
  return {
    id: crypto.randomUUID(),
    name,
    sections: ['Literature', 'Methods', 'Data', 'Report'],
    members: [{ userId: 'me', role: 'owner' }],
    createdAt: now,
    updatedAt: now,
  };
}
async function loadProjects(): Promise<void> {
  state.projects = await sendRequest({ type: 'projects/list' });
  if (state.projects.length === 0) {
    const seed = makeProject('My Research Project');
    await sendRequest({ type: 'projects/put', project: seed });
    state.projects = [seed];
  }
  if (!activeProject()) state.activeProjectId = state.projects[0]?.id ?? null;
}
async function loadProjectData(): Promise<void> {
  if (!state.activeProjectId) {
    state.documents = [];
    state.annotations = [];
    state.styles = [];
    return;
  }
  const projectId = state.activeProjectId;
  const [documents, annotations, references, styles] = await Promise.all([
    sendRequest({ type: 'documents/listByProject', projectId }),
    sendRequest({ type: 'annotations/listByProject', projectId }),
    sendRequest({ type: 'references/listByProject', projectId }),
    sendRequest({ type: 'citationStyles/list' }),
  ]);
  state.documents = documents;
  state.annotations = annotations;
  state.references = references;
  state.styles = styles;
}

/* ---- Sidebar ---- */
function renderNav(): void {
  const nav = $('#nav');
  nav.innerHTML =
    `<div class="nav-lbl">Workspace</div>` +
    NAV.map((n) => {
      const active = state.route === n.id;
      const ct = n.count();
      return `<button class="nav-item${active ? ' active' : ''}" data-route="${n.id}"${active ? ' aria-current="page"' : ''}>
        <svg class="ni-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${n.icon}</svg>
        <span>${n.label}</span>${ct !== undefined ? `<span class="ni-ct">${ct}</span>` : ''}</button>`;
    }).join('');
  $$('.nav-item', nav).forEach((b) => {
    b.onclick = () => {
      const r = b.dataset.route;
      if (r && isRoute(r)) go(r);
      closeSidebar();
    };
  });
}
function renderProjSwitch(): void {
  const p = activeProject();
  $('#pName').textContent = p?.name ?? '—';
  $('#pSub').textContent = p?.description ?? 'Research project';
  const menu = $('#projMenu');
  menu.innerHTML =
    state.projects
      .map(
        (pr) => `<button class="pmi${pr.id === state.activeProjectId ? ' active' : ''}" role="menuitem" data-p="${pr.id}">
        <span class="dot"></span><span class="nm">${esc(pr.name)}</span></button>`,
      )
      .join('') +
    `<div class="pm-sep"></div><button class="pmi" role="menuitem" data-new="1"><span class="dot" style="background:var(--accent)"></span><span class="nm" style="color:var(--accent);font-weight:560">New project…</span></button>`;
  $$('[data-p]', menu).forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.p;
      if (id) void switchProject(id);
      toggleProjMenu(false);
    };
  });
  $('[data-new]', menu).onclick = () => {
    toggleProjMenu(false);
    void createProject();
  };
}
async function switchProject(id: Id): Promise<void> {
  if (id === state.activeProjectId) return;
  state.activeProjectId = id;
  state.docFilter = { search: '', status: 'all' };
  await loadProjectData();
  render();
}
async function createProject(): Promise<void> {
  const project = makeProject(`Project ${state.projects.length + 1}`);
  await sendRequest({ type: 'projects/put', project });
  state.projects = [...state.projects, project];
  state.activeProjectId = project.id;
  await loadProjectData();
  render();
  toast('New project created', ICON.check);
}
function toggleProjMenu(on?: boolean): void {
  const menu = $('#projMenu');
  const btn = $('#projBtn');
  const open = on ?? !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
}

/* ---- Router ---- */
function go(route: Route): void {
  state.route = route;
  render();
  $('#view').scrollTop = 0;
}
const VIEWS: Record<Route, (view: HTMLElement, actions: HTMLElement) => void> = {
  overview: renderOverview,
  documents: renderDocuments,
  annotations: (v) => placeholder(v, 'Annotations', 'Notes across the project will collect here.'),
  references: renderReferences,
  styles: (v) => placeholder(v, 'Citation styles', 'Style profiles and the rule editor arrive soon.'),
};
function render(): void {
  renderProjSwitch();
  renderNav();
  const [title, sub] = ROUTE_TITLES[state.route];
  $('#viewTitle').textContent = title;
  const name = activeProject()?.name ?? 'No project';
  $('#viewSub').textContent = `${name} · ${sub}`;
  const actions = $('#viewActions');
  actions.innerHTML = '';
  VIEWS[state.route]($('#view'), actions);
}

/* ---- Overview + Kanban ---- */
function renderOverview(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = `<button class="btn btn--sm" id="aExport">${ICON.down} Export bibliography</button>`;
  $('#aExport', actions).onclick = () => void exportBibliography();

  const p = activeProject();
  const progress = computeProgress(state.documents);
  const inReport = state.annotations.filter((a) => a.status === 'includedInReport').length;
  const members = p?.members.length ?? 0;
  const style = activeStyle();
  const styleValue = style ? esc(style.name.split(' ')[0]) : '—';
  const styleSub = style ? esc(style.name) : 'No style profile yet';

  view.innerHTML = `
    <div class="stats">
      <div class="tile"><div class="tl">Sources</div><div class="tv">${state.documents.length}</div><div class="tsub">${p?.sections.length ?? 0} sections · ${members} member${members === 1 ? '' : 's'}</div></div>
      <div class="tile"><div class="tl"><span class="d" style="background:var(--s-analysed)"></span>Analysed</div><div class="tv">${progress.reviewed}</div><div class="tsub">${progress.percent}% of the corpus reviewed</div></div>
      <div class="tile"><div class="tl">Annotations</div><div class="tv">${state.annotations.length}</div><div class="tsub">${inReport} included in the report</div></div>
      <div class="tile"><div class="tl">Style</div><div class="tv" style="font-size:26px;padding-top:4px">${styleValue}</div><div class="tsub">${styleSub}</div></div>
    </div>
    <div class="sec-h"><h2>Workflow</h2><span class="ln"></span><span class="cnt">drag · or focus a card and press ← →</span></div>
    <div class="kanban" id="kanban"></div>`;
  renderKanban($('#kanban', view));
}

function renderKanban(board: HTMLElement): void {
  board.innerHTML = STATUS_META.map((s) => {
    const items = state.documents.filter((d) => d.status === s.id);
    return `<section class="kcol" data-col="${s.id}" aria-label="${s.label}">
      <div class="kcol-h"><span class="d" style="background:${statusDot(s.id)}"></span><span class="knm">${s.label}</span><span class="kct">${items.length}</span></div>
      <div class="kcards" data-drop="${s.id}" role="list">${items.map(kanbanCard).join('') || `<div class="kempty">Drop a source here</div>`}</div>
    </section>`;
  }).join('');
  wireKanban(board);
}

function kanbanCard(d: Document): string {
  const label = statusLabel(d.status);
  const title = d.metadata.title ?? d.url;
  const notes = notesFor(d.id);
  return `<article class="kcard${state.flash === d.id ? ' flash' : ''}" draggable="true" data-id="${d.id}" tabindex="0" role="listitem" aria-label="${esc(title)} — ${label}. Arrow keys move between stages, Enter to change status.">
    <div class="kt">${esc(title)}</div>
    <div class="km">${esc(authorLabel(d.metadata.authors))}${d.metadata.year ? ` · ${d.metadata.year}` : ''}</div>
    <div class="kf">
      <button class="spill" aria-label="Change status"><span class="d" style="background:${statusDot(d.status)}"></span>${label}</button>
      ${d.section ? `<span class="chip chip--sec">${esc(d.section)}</span>` : ''}
      ${notes ? `<span class="kn">${ICON.note}${notes}</span>` : ''}
    </div></article>`;
}

function wireKanban(board: HTMLElement): void {
  $$('.kcard', board).forEach((el) => {
    const id = el.dataset.id;
    if (!id) return;
    el.addEventListener('dragstart', (e) => {
      state.drag = id;
      el.classList.add('dragging');
      (e as DragEvent).dataTransfer!.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      state.drag = null;
      $$('.kcol', board).forEach((c) => c.classList.remove('drop'));
    });
    $('.spill', el).addEventListener('click', (e) => {
      e.stopPropagation();
      const doc = docById(id);
      if (doc) openStatusPop(e.currentTarget as HTMLElement, doc);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Enter') return;
      e.preventDefault();
      const doc = docById(id);
      if (!doc) return;
      if (e.key === 'Enter') {
        openStatusPop($('.spill', el), doc);
        return;
      }
      const cur = DOCUMENT_STATUSES.indexOf(doc.status);
      const next =
        e.key === 'ArrowRight'
          ? Math.min(DOCUMENT_STATUSES.length - 1, cur + 1)
          : Math.max(0, cur - 1);
      const ns = DOCUMENT_STATUSES[next];
      if (next !== cur && ns) void setStatus(doc, ns, id);
    });
  });
  $$('.kcol', board).forEach((col) => {
    const zone = $('[data-drop]', col);
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drop');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains((e as DragEvent).relatedTarget as Node | null)) col.classList.remove('drop');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const id = state.drag;
      if (!id) return;
      const doc = docById(id);
      const ns = zone.dataset.drop as DocumentStatus | undefined;
      if (doc && ns) void setStatus(doc, ns);
    });
  });
}

async function setStatus(doc: Document, ns: DocumentStatus, refocusId?: Id): Promise<void> {
  if (doc.status === ns) return;
  const updated: Document = { ...doc, status: ns, updatedAt: nowIso() };
  try {
    await sendRequest({ type: 'documents/put', document: updated });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not move source', ICON.warn, true);
    return;
  }
  state.documents = state.documents.map((d) => (d.id === doc.id ? updated : d));
  state.flash = doc.id;
  render();
  if (refocusId) {
    requestAnimationFrame(() => {
      $<HTMLElement>(`#kanban .kcard[data-id="${refocusId}"]`)?.focus();
    });
  }
  setTimeout(() => {
    state.flash = null;
  }, 900);
  toast(`Moved to “${statusLabel(ns)}”`, ICON.check);
}

async function exportBibliography(): Promise<void> {
  if (!state.activeProjectId || state.documents.length === 0) {
    toast('No sources to export yet', ICON.warn, true);
    return;
  }
  const template = templateFor(activeStyle()?.baseStyleId ?? 'apa');
  try {
    const bibliography = await sendRequest({
      type: 'citations/bibliography',
      projectId: state.activeProjectId,
      template,
    });
    await navigator.clipboard.writeText(bibliography);
    toast(`Bibliography copied · ${state.documents.length} entries`, ICON.copy);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t export bibliography', ICON.warn, true);
  }
}

/* ---- Status popover ---- */
function openStatusPop(anchor: HTMLElement, doc: Document): void {
  const pop = $('#pop');
  pop.innerHTML =
    `<div class="pl">Move to</div>` +
    STATUS_META.map(
      (s) =>
        `<button class="pi${s.id === doc.status ? ' cur' : ''}" data-set="${s.id}"><span class="d" style="background:${statusDot(s.id)}"></span>${s.label}<span class="ck">${ICON.check}</span></button>`,
    ).join('');
  $$('[data-set]', pop).forEach((b) => {
    b.onclick = () => {
      const ns = b.dataset.set as DocumentStatus | undefined;
      closePop();
      if (ns) void setStatus(doc, ns);
    };
  });
  placePop(anchor);
}
function placePop(anchor: HTMLElement): void {
  const pop = $('#pop');
  const r = anchor.getBoundingClientRect();
  pop.classList.add('open');
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.min(r.left, window.innerWidth - pw - 12);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 12) top = r.top - ph - 6;
  pop.style.left = `${Math.max(12, left)}px`;
  pop.style.top = `${top}px`;
}

/* ---- Documents ---- */
function renderDocuments(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = '';
  if (state.documents.length === 0) {
    view.innerHTML = emptyState(
      'No documents yet',
      'Sources you capture with the side panel appear here, grouped by status and section.',
    );
    return;
  }
  view.innerHTML = `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="q" placeholder="Search title, author, DOI…" value="${esc(state.docFilter.search)}" aria-label="Search documents">
      </div>
      <div class="filters" id="dfilters"></div>
    </div>
    <div id="dtbl"></div>`;
  $<HTMLInputElement>('#q', view).addEventListener('input', (e) => {
    state.docFilter = { ...state.docFilter, search: (e.target as HTMLInputElement).value };
    drawDocuments();
  });
  renderDocFilters($('#dfilters', view));
  drawDocuments();
}

function renderDocFilters(host: HTMLElement): void {
  const counts = statusCounts(state.documents);
  const opts: Array<{ id: ListFilter['status']; label: string; dot?: string }> = [
    { id: 'all', label: 'All' },
    ...STATUS_META.map((s) => ({ id: s.id, label: s.label, dot: statusDot(s.id) })),
  ];
  host.innerHTML = opts
    .map(
      (o) =>
        `<button class="fchip" data-v="${o.id}" aria-pressed="${state.docFilter.status === o.id}">${o.dot ? `<span class="d" style="background:${o.dot}"></span>` : ''}${o.label} ${counts[o.id]}</button>`,
    )
    .join('');
  $$('.fchip', host).forEach((b) => {
    b.onclick = () => {
      state.docFilter = { ...state.docFilter, status: b.dataset.v as ListFilter['status'] };
      $$('.fchip', host).forEach((x) =>
        x.setAttribute('aria-pressed', String(x.dataset.v === state.docFilter.status)),
      );
      drawDocuments();
    };
  });
}

function drawDocuments(): void {
  const box = $('#dtbl');
  const rows = filterDocuments(state.documents, state.docFilter);
  if (rows.length === 0) {
    box.innerHTML = `<div class="empty" style="padding:40px"><div class="et">Nothing matches</div><div class="ed">Clear the search or status filter.</div></div>`;
    return;
  }
  box.innerHTML = `<table class="tbl"><thead><tr><th>Source</th><th>Section</th><th>Status</th><th class="num">Notes</th><th></th></tr></thead><tbody>${rows
    .map((d) => {
      const m = d.metadata;
      const sub = [authorLabel(m.authors), m.year, m.journal].filter(Boolean).join(' · ');
      const notes = notesFor(d.id);
      return `<tr data-id="${d.id}">
        <td><div class="ttl">${esc(m.title ?? d.url)}</div><div class="sub">${esc(sub)}</div></td>
        <td>${d.section ? `<span class="chip chip--sec">${esc(d.section)}</span>` : '<span class="mono">—</span>'}</td>
        <td><button class="spill" aria-label="Change status"><span class="d" style="background:${statusDot(d.status)}"></span>${statusLabel(d.status)}</button></td>
        <td class="num">${notes || '—'}</td>
        <td>${m.doi ? `<a href="https://doi.org/${encodeURIComponent(m.doi)}" target="_blank" rel="noopener" title="Open source" aria-label="Open source">${ICON.ext}</a>` : ''}</td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
  $$('.spill', box).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.closest('tr')?.getAttribute('data-id');
      const doc = id ? docById(id) : undefined;
      if (doc) openStatusPop(e.currentTarget as HTMLElement, doc);
    });
  });
}

/* ---- References ---- */
interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}
interface Csl {
  title?: string;
  author?: CslName[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  type?: string;
}
const SOURCE_LABEL: Record<Reference['source'], string> = {
  extractedFromPage: 'Extracted',
  importedFromZotero: 'Zotero',
  manual: 'Manual',
};
function cslNameLabel(n: CslName): string {
  if (n.literal) return n.literal;
  return [n.family, n.given].filter(Boolean).join(', ');
}
function referenceLine(csl: Csl): { title: string; sub: string; doi?: string } {
  const authors = (csl.author ?? []).map(cslNameLabel).filter(Boolean);
  const year = csl.issued?.['date-parts']?.[0]?.[0];
  const authorPart =
    authors.length === 0
      ? 'Unknown author'
      : authors.length <= 3
        ? authors.join('; ')
        : `${authors[0]} et al.`;
  const journal = csl['container-title'];
  const vol = csl.volume ? `, ${csl.volume}${csl.issue ? `(${csl.issue})` : ''}` : '';
  const pages = csl.page ? `, ${csl.page}` : '';
  const sub = `${authorPart}${year ? ` (${year})` : ''}.${journal ? ` ${journal}${vol}${pages}.` : ''}`;
  const result: { title: string; sub: string; doi?: string } = {
    title: csl.title ?? 'Untitled reference',
    sub,
  };
  if (csl.DOI) result.doi = csl.DOI;
  return result;
}
function cslTypeLabel(type?: string): string {
  if (!type) return 'Reference';
  const map: Record<string, string> = {
    'article-journal': 'Article',
    article: 'Article',
    'paper-conference': 'Paper',
    book: 'Book',
    chapter: 'Chapter',
    dataset: 'Dataset',
    report: 'Report',
    webpage: 'Web page',
  };
  return map[type] ?? type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function renderReferences(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = `<button class="btn btn--sm" id="rImport">${ICON.up} Import</button><button class="btn btn--sm" id="rExport">${ICON.down} Export</button>`;
  $('#rImport', actions).onclick = (e) => {
    e.stopPropagation();
    openImportPopover(e.currentTarget as HTMLElement);
  };
  $('#rExport', actions).onclick = () => void exportBibliography();

  if (state.references.length === 0) {
    view.innerHTML = emptyState(
      'No references yet',
      'Import a reference by DOI, or capture a source with the side panel to build your bibliography.',
    );
    return;
  }
  view.innerHTML = `<table class="tbl"><thead><tr><th>Reference</th><th>Type</th><th>Origin</th><th>Used in</th><th></th></tr></thead><tbody>${state.references
    .map((ref) => {
      const csl = ref.cslData as Csl;
      const line = referenceLine(csl);
      const used = ref.usedInOutputs.length
        ? ref.usedInOutputs.map((u) => `<span class="chip">${esc(u)}</span>`).join(' ')
        : '<span class="mono">—</span>';
      return `<tr data-id="${ref.id}">
        <td><div class="ttl">${esc(line.title)}</div><div class="sub">${esc(line.sub)}</div>${line.doi ? `<div class="mono" style="margin-top:4px">doi:${esc(line.doi)}</div>` : ''}</td>
        <td><span class="chip chip--sec">${esc(cslTypeLabel(csl.type))}</span></td>
        <td><span class="stat-tag">${SOURCE_LABEL[ref.source]}</span></td>
        <td>${used}</td>
        <td><button class="btn btn--ghost btn--sm" data-cite="${ref.id}" aria-label="Copy citation">${ICON.copy}</button></td>
      </tr>`;
    })
    .join('')}</tbody></table>`;
  $$('[data-cite]', view).forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.cite;
      if (id) void copyReferenceCitation(id);
    };
  });
}

const IMPORT_SOURCES: Array<{ label: string; doi?: boolean }> = [
  { label: 'DOI / identifier', doi: true },
  { label: 'Zotero library' },
  { label: 'BibTeX (.bib) file' },
  { label: 'RIS (.ris) file' },
];
function openImportPopover(anchor: HTMLElement): void {
  const pop = $('#pop');
  pop.innerHTML =
    `<div class="pl">Import from</div>` +
    IMPORT_SOURCES.map((s) =>
      s.doi
        ? `<button class="pi imp-src" data-doi="1"><span>${esc(s.label)}</span></button>`
        : `<button class="pi imp-src" disabled><span>${esc(s.label)}</span><span class="soon">Soon</span></button>`,
    ).join('');
  $('[data-doi]', pop).onclick = () => showDoiForm();
  placePop(anchor);
}
function showDoiForm(): void {
  const pop = $('#pop');
  pop.innerHTML = `<div class="pl">Import by DOI</div>
    <div class="pop-form">
      <input id="doiInput" class="sel" placeholder="10.1016/j.example.2020.01.001" aria-label="DOI" style="width:240px">
      <button class="btn btn--primary btn--sm" id="doiGo">${ICON.up} Import</button>
    </div>`;
  const input = $<HTMLInputElement>('#doiInput', pop);
  const submit = (): void => void importByDoi(input.value);
  $('#doiGo', pop).onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  input.focus();
}
async function importByDoi(raw: string): Promise<void> {
  const doi = raw.trim();
  if (!doi) {
    toast('Enter a DOI to import', ICON.warn, true);
    return;
  }
  if (!state.activeProjectId) return;
  const granted = await chrome.permissions.request({
    origins: [
      'https://doi.org/*',
      'https://data.crossref.org/*',
      'https://data.datacite.org/*',
    ],
  });
  if (!granted) {
    toast('Permission is needed to fetch DOI metadata', ICON.warn, true);
    return;
  }
  closePop();
  try {
    await sendRequest({ type: 'references/importByDoi', projectId: state.activeProjectId, doi });
    state.references = await sendRequest({
      type: 'references/listByProject',
      projectId: state.activeProjectId,
    });
    render();
    toast('Reference imported', ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'DOI import failed', ICON.warn, true);
  }
}
async function copyReferenceCitation(referenceId: Id): Promise<void> {
  const template = templateFor(activeStyle()?.baseStyleId ?? 'apa');
  try {
    const { bibliography } = await sendRequest({
      type: 'citations/reference',
      referenceId,
      template,
    });
    await navigator.clipboard.writeText(bibliography);
    toast('Citation copied', ICON.copy);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t copy citation', ICON.warn, true);
  }
}

function emptyState(title: string, desc: string): string {
  return `<div class="empty">
    <div class="em"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
    <div class="et">${esc(title)}</div>
    <div class="ed">${esc(desc)}</div>
  </div>`;
}

function placeholder(view: HTMLElement, title: string, desc: string): void {
  view.innerHTML = `<div class="empty">
    <div class="em"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
    <div class="et">${esc(title)}</div>
    <div class="ed">${esc(desc)}</div>
  </div>`;
}

/* ---- Toast ---- */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, icon = ICON.check, error = false): void {
  const wrap = $('#toastWrap');
  wrap.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' toast--error' : '');
  t.setAttribute('role', error ? 'alert' : 'status');
  t.innerHTML = `${icon}<span>${esc(msg)}</span>`;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 240);
    },
    error ? 3600 : 2600,
  );
}

/* ---- Popover (shared; used by later milestones) ---- */
function closePop(): void {
  $('#pop').classList.remove('open');
}

/* ---- Mobile sidebar ---- */
function openSidebar(): void {
  $('#sidebar').classList.add('open');
  $('#scrim').classList.add('on');
}
function closeSidebar(): void {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('on');
}

/* ---- Init ---- */
async function init(): Promise<void> {
  const version = chrome.runtime.getManifest().version;
  $('#appVersion').textContent = `v${version}`;

  $('#projBtn').onclick = (e) => {
    e.stopPropagation();
    toggleProjMenu();
  };
  $('#menuToggle').onclick = openSidebar;
  $('#scrim').onclick = closeSidebar;
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.proj-switch')) toggleProjMenu(false);
    if (!target.closest('#pop') && !target.closest('.spill')) closePop();
  });
  window.addEventListener('scroll', closePop, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleProjMenu(false);
      closePop();
      closeSidebar();
    }
  });

  try {
    await loadProjects();
    await loadProjectData();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to load projects', ICON.warn, true);
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => void init());
