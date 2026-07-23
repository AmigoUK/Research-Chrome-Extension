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
import type {
  Project,
  Document,
  Annotation,
  AnnotationStatus,
  Anchor,
  Reference,
  CitationStyle,
  CitationUserRules,
  CitationSystem,
  Id,
} from '../core/model/types';
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
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 5v14M5 12h14"/></svg>',
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
  annoFilter: { search: string; status: AnnotationStatus | 'all' };
  selectedStyleId: Id | null;
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
  annoFilter: { search: '', status: 'all' },
  selectedStyleId: null,
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
function defaultRules(system: CitationSystem, over: Partial<CitationUserRules> = {}): CitationUserRules {
  return {
    system,
    maxAuthors: 3,
    etAlUseFirst: 1,
    nameAnd: 'symbol',
    includeDoi: true,
    doiAsUri: true,
    includeUrl: false,
    includeIssue: true,
    pagePrefix: false,
    foiTemplate: false,
    legalTemplate: false,
    ...over,
  };
}
const SEED_STYLES: CitationStyle[] = [
  { id: 'apa', name: 'APA 7th', baseStyleId: 'apa', userRules: defaultRules('authorDate') },
  { id: 'chicago', name: 'Chicago 17th', baseStyleId: 'chicago', userRules: defaultRules('footnote') },
  {
    id: 'harvard',
    name: 'Harvard',
    baseStyleId: 'harvard',
    userRules: defaultRules('authorDate', { includeDoi: false, includeUrl: true, maxAuthors: 6 }),
  },
];
async function ensureSeedStyles(): Promise<void> {
  if (state.styles.length > 0) return;
  for (const style of SEED_STYLES) await sendRequest({ type: 'citationStyles/put', style });
  state.styles = SEED_STYLES.map((s) => ({ ...s, userRules: { ...s.userRules } }));
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
  state.annoFilter = { search: '', status: 'all' };
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
  annotations: renderAnnotations,
  references: renderReferences,
  styles: renderStyles,
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

/* ---- Annotations ---- */
const ANNO_STATUS: Record<AnnotationStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: '' },
  accepted: { label: 'Accepted', cls: 'ok' },
  rejected: { label: 'Rejected', cls: 'rej' },
  includedInReport: { label: 'In report', cls: 'rep' },
};
const ANNO_STATUSES = Object.keys(ANNO_STATUS) as AnnotationStatus[];

function anchorLabel(anchor: Anchor): string {
  if (anchor.kind === 'pdf') {
    const first = anchor.selectors[0];
    return first ? `p. ${first.page}` : 'PDF region';
  }
  for (const sel of anchor.selectors) {
    if (sel.type === 'textQuote' && sel.exact) {
      const q = sel.exact.trim();
      return q.length > 40 ? `“${q.slice(0, 40)}…”` : `“${q}”`;
    }
  }
  return 'Web selection';
}

function renderAnnotations(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = '';
  if (state.annotations.length === 0) {
    view.innerHTML = emptyState(
      'No annotations yet',
      'Highlight a passage on a page with the side panel and your notes collect here.',
    );
    return;
  }
  view.innerHTML = `
    <div class="toolbar">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="qa" placeholder="Search notes, tags…" value="${esc(state.annoFilter.search)}" aria-label="Search annotations">
      </div>
      <div class="filters" id="afilters"></div>
    </div>
    <div id="alist"></div>`;
  $<HTMLInputElement>('#qa', view).addEventListener('input', (e) => {
    state.annoFilter = { ...state.annoFilter, search: (e.target as HTMLInputElement).value };
    drawAnnotations();
  });
  renderAnnoFilters($('#afilters', view));
  drawAnnotations();
}

function renderAnnoFilters(host: HTMLElement): void {
  const opts: Array<{ id: DashState['annoFilter']['status']; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Draft' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'includedInReport', label: 'In report' },
    { id: 'rejected', label: 'Rejected' },
  ];
  host.innerHTML = opts
    .map(
      (o) =>
        `<button class="fchip" data-v="${o.id}" aria-pressed="${state.annoFilter.status === o.id}">${o.label}</button>`,
    )
    .join('');
  $$('.fchip', host).forEach((b) => {
    b.onclick = () => {
      state.annoFilter = {
        ...state.annoFilter,
        status: b.dataset.v as DashState['annoFilter']['status'],
      };
      $$('.fchip', host).forEach((x) =>
        x.setAttribute('aria-pressed', String(x.dataset.v === state.annoFilter.status)),
      );
      drawAnnotations();
    };
  });
}

function filterAnnotations(): Annotation[] {
  const q = state.annoFilter.search.trim().toLowerCase();
  return state.annotations.filter((a) => {
    if (state.annoFilter.status !== 'all' && a.status !== state.annoFilter.status) return false;
    if (q && !(a.content + ' ' + a.tags.join(' ')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function drawAnnotations(): void {
  const box = $('#alist');
  const rows = filterAnnotations();
  if (rows.length === 0) {
    box.innerHTML = `<div class="empty" style="padding:40px"><div class="et">No annotations match</div><div class="ed">Try another tag or status.</div></div>`;
    return;
  }
  box.innerHTML = rows
    .map((a) => {
      const doc = docById(a.documentId);
      const m = doc?.metadata;
      const srcLine = m
        ? [authorLabel(m.authors), m.year, m.journal].filter(Boolean).join(' · ')
        : '';
      const st = ANNO_STATUS[a.status];
      return `<article class="anno" data-id="${a.id}">
        <div class="anno-top"><span class="anno-anchor">${esc(anchorLabel(a.anchor))}</span><span class="anno-src">${esc(srcLine)}</span></div>
        <div class="anno-body">${esc(a.content)}</div>
        <div class="anno-foot">
          <button class="stat-tag ${st.cls}" data-status aria-label="Change review status">${st.label}</button>
          ${a.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
          <button class="btn btn--ghost btn--sm" style="margin-left:auto" data-cite="${a.documentId}">${ICON.copy} Cite</button>
        </div></article>`;
    })
    .join('');
  $$('[data-status]', box).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.closest('.anno')?.getAttribute('data-id');
      const anno = id ? state.annotations.find((a) => a.id === id) : undefined;
      if (anno) openAnnoStatusPop(e.currentTarget as HTMLElement, anno);
    });
  });
  $$('[data-cite]', box).forEach((b) => {
    b.onclick = () => {
      const docId = b.dataset.cite;
      if (docId) void citeDocument(docId);
    };
  });
}

function openAnnoStatusPop(anchor: HTMLElement, anno: Annotation): void {
  const pop = $('#pop');
  pop.innerHTML =
    `<div class="pl">Review status</div>` +
    ANNO_STATUSES.map(
      (s) =>
        `<button class="pi${s === anno.status ? ' cur' : ''}" data-set="${s}">${ANNO_STATUS[s].label}<span class="ck">${ICON.check}</span></button>`,
    ).join('');
  $$('[data-set]', pop).forEach((b) => {
    b.onclick = () => {
      const ns = b.dataset.set as AnnotationStatus | undefined;
      closePop();
      if (ns) void setAnnotationStatus(anno, ns);
    };
  });
  placePop(anchor);
}

async function setAnnotationStatus(anno: Annotation, status: AnnotationStatus): Promise<void> {
  if (anno.status === status) return;
  const updated: Annotation = { ...anno, status, updatedAt: nowIso() };
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not update note', ICON.warn, true);
    return;
  }
  state.annotations = state.annotations.map((a) => (a.id === anno.id ? updated : a));
  render();
  toast(`Note set to “${ANNO_STATUS[status].label}”`, ICON.check);
}

async function citeDocument(documentId: Id): Promise<void> {
  const template = templateFor(activeStyle()?.baseStyleId ?? 'apa');
  try {
    const { bibliography } = await sendRequest({
      type: 'citations/document',
      documentId,
      template,
    });
    await navigator.clipboard.writeText(bibliography);
    toast('Citation copied', ICON.copy);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t copy citation', ICON.warn, true);
  }
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

/* ---- Citation styles (lightweight editor) ---- */
interface PreviewSample {
  label: string;
  authors: Array<{ family: string; given: string }>;
  year: number;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  page: string;
  doi: string;
}
const PREVIEW_SAMPLES: PreviewSample[] = [
  {
    label: '1 author',
    authors: [{ family: 'Oke', given: 'T. R.' }],
    year: 1982,
    title: 'The energetic basis of the urban heat island',
    journal: 'Quarterly Journal of the Royal Meteorological Society',
    volume: '108',
    issue: '455',
    page: '1–24',
    doi: '10.1002/qj.49710845502',
  },
  {
    label: '4 authors — triggers “et al.”',
    authors: [
      { family: 'Gasparrini', given: 'A.' },
      { family: 'Guo', given: 'Y.' },
      { family: 'Hashizume', given: 'M.' },
      { family: 'Lavigne', given: 'E.' },
    ],
    year: 2015,
    title: 'Mortality risk attributable to high and low ambient temperature',
    journal: 'The Lancet',
    volume: '386',
    issue: '9991',
    page: '369–375',
    doi: '10.1016/S0140-6736(14)62114-0',
  },
];
function previewCite(s: PreviewSample, r: CitationUserRules): { inText: string; biblio: string } {
  const a = s.authors;
  const surnames = a.map((x) => x.family);
  const trunc = a.length > r.maxAuthors;
  let inText: string;
  if (r.system === 'footnote') inText = '¹ (footnote)';
  else if (r.system === 'numeric') inText = '[1]';
  else if (a.length === 1) inText = `(${surnames[0]}, ${s.year})`;
  else if (a.length === 2) inText = `(${surnames[0]} & ${surnames[1]}, ${s.year})`;
  else
    inText = `(${(trunc ? [surnames[0], 'et al.'] : surnames).join(trunc ? ' ' : ', ')}, ${s.year})`;
  const doi = r.includeDoi ? ` https://doi.org/${s.doi}` : '';
  const url = r.includeUrl && !r.includeDoi ? ' Retrieved from the journal site.' : '';
  const iss = r.includeIssue && s.issue ? `(${s.issue})` : '';
  let biblio: string;
  if (r.system === 'footnote') {
    const names =
      (trunc ? a.slice(0, r.maxAuthors) : a).map((p) => `${p.given} ${p.family}`).join(', ') +
      (trunc ? ', et al.' : '');
    biblio = `¹ ${names}, “${s.title},” ${s.journal} ${s.volume}, no. ${s.issue} (${s.year}): ${s.page}.${doi}`;
  } else {
    const names =
      (trunc ? a.slice(0, r.maxAuthors) : a).map((p) => `${p.family}, ${p.given}`).join(', ') +
      (trunc ? ', et al.' : '');
    biblio = `${names} (${s.year}). ${s.title}. ${s.journal}, ${s.volume}${iss}, ${s.page}.${doi}${url}`;
  }
  return { inText, biblio };
}

function selectedStyle(): CitationStyle | undefined {
  return state.styles.find((s) => s.id === state.selectedStyleId) ?? state.styles[0];
}

function renderStyles(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="sFull">Full editor</button><button class="btn btn--primary btn--sm" id="sSave">${ICON.check} Save profile</button>`;
  $('#sFull', actions).onclick = () => toast('The full CSL rule editor arrives in Phase 4');
  $('#sSave', actions).onclick = () => void saveStyle();

  if (state.styles.length === 0) {
    view.innerHTML = emptyState('No citation styles', 'Add a style profile to format your citations.');
    return;
  }
  if (!state.selectedStyleId) state.selectedStyleId = state.styles[0]?.id ?? null;

  view.innerHTML = `<div class="styles-grid">
    <div>
      <div class="sec-h" style="margin-top:0"><h2 style="font-size:14px">Profiles</h2></div>
      <div class="style-list" id="slist"></div>
      <button class="btn btn--sm" style="margin-top:11px;width:100%" id="sNew">${ICON.plus} New style</button>
    </div>
    <div><div class="editor" id="editor"></div></div>
  </div>`;
  $('#sNew', view).onclick = () => void createStyle();
  drawStyleList();
  drawStyleEditor();
}

function drawStyleList(): void {
  const host = $('#slist');
  host.innerHTML = state.styles
    .map(
      (s) => `<button class="style-card${s.id === state.selectedStyleId ? ' sel' : ''}" data-s="${s.id}">
      <div class="snm">${esc(s.name)}</div>
      <div class="sb">${s.userRules.system === 'footnote' ? 'Footnote' : s.userRules.system === 'numeric' ? 'Numeric' : 'Author–date'} · base ${esc(s.baseStyleId)}</div>
    </button>`,
    )
    .join('');
  $$('[data-s]', host).forEach((b) => {
    b.onclick = () => {
      state.selectedStyleId = b.dataset.s ?? null;
      drawStyleList();
      drawStyleEditor();
    };
  });
}

function drawStyleEditor(): void {
  const style = selectedStyle();
  if (!style) return;
  const r = style.userRules;
  const editor = $('#editor');
  editor.innerHTML = `
    <div class="ed-row"><div class="ed-lbl"><b>Citation system</b><span>Author–date in text, or numbered footnotes</span></div>
      <div class="seg" id="sysSeg"><button data-v="authorDate" aria-pressed="${r.system === 'authorDate'}">Author–date</button><button data-v="footnote" aria-pressed="${r.system === 'footnote'}">Footnote</button></div></div>
    <div class="ed-row"><div class="ed-lbl"><b>Maximum authors</b><span>Before the list is truncated with “et al.”</span></div>
      <div class="stepper"><button data-step="-1" aria-label="Fewer">−</button><span class="val" id="maVal">${r.maxAuthors}</span><button data-step="1" aria-label="More">+</button></div></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include DOI</b><span>Append the DOI to bibliography entries</span></div>
      <button class="sw" role="switch" id="swDoi" aria-checked="${r.includeDoi}" aria-label="Include DOI"></button></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include URL</b><span>When no DOI is present</span></div>
      <button class="sw" role="switch" id="swUrl" aria-checked="${r.includeUrl}" aria-label="Include URL"></button></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include issue number</b><span>Show the issue alongside the volume</span></div>
      <button class="sw" role="switch" id="swIssue" aria-checked="${r.includeIssue}" aria-label="Include issue number"></button></div>
    <div class="preview" id="cpreview"></div>`;
  $$('#sysSeg button', editor).forEach((b) => {
    b.onclick = () => {
      r.system = b.dataset.v as CitationSystem;
      drawStyleList();
      drawStyleEditor();
    };
  });
  $$('.stepper [data-step]', editor).forEach((b) => {
    b.onclick = () => {
      r.maxAuthors = Math.max(1, Math.min(20, r.maxAuthors + Number(b.dataset.step)));
      drawStyleEditor();
    };
  });
  $('#swDoi', editor).onclick = () => {
    r.includeDoi = !r.includeDoi;
    drawStyleEditor();
  };
  $('#swUrl', editor).onclick = () => {
    r.includeUrl = !r.includeUrl;
    drawStyleEditor();
  };
  $('#swIssue', editor).onclick = () => {
    r.includeIssue = !r.includeIssue;
    drawStyleEditor();
  };

  $('#cpreview', editor).innerHTML =
    `<div class="pl">Live preview · ${esc(style.name)} · ${r.system === 'footnote' ? 'footnote' : r.system === 'numeric' ? 'numeric' : 'author–date'}</div>` +
    PREVIEW_SAMPLES.map((sample) => {
      const f = previewCite(sample, r);
      return `<div class="pex"><div class="pex-l">${esc(sample.label)}</div><div class="intxt">${esc(f.inText)}</div><div class="pv">${esc(f.biblio)}</div></div>`;
    }).join('');
}

async function saveStyle(): Promise<void> {
  const style = selectedStyle();
  if (!style) return;
  try {
    await sendRequest({ type: 'citationStyles/put', style: { ...style, userRules: { ...style.userRules } } });
    toast(`Saved · ${style.name}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t save style', ICON.warn, true);
  }
}

async function createStyle(): Promise<void> {
  const base = selectedStyle();
  const style: CitationStyle = {
    id: crypto.randomUUID(),
    name: `New style ${state.styles.length + 1}`,
    baseStyleId: base?.baseStyleId ?? 'apa',
    userRules: defaultRules(base?.userRules.system ?? 'authorDate'),
  };
  try {
    await sendRequest({ type: 'citationStyles/put', style });
    state.styles = [...state.styles, style];
    state.selectedStyleId = style.id;
    render();
    toast('New style created', ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t create style', ICON.warn, true);
  }
}

function emptyState(title: string, desc: string): string {
  return `<div class="empty">
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
    await ensureSeedStyles();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to load projects', ICON.warn, true);
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => void init());
