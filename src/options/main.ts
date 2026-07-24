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
  ActivityEvent,
  ActivityKind,
  Anchor,
  CommentThread,
  SyncMode,
  Reference,
  CitationStyle,
  CitationUserRules,
  CitationSystem,
  ProjectRole,
  Id,
} from '../core/model/types';
import { SELF_USER_ID } from '../core/model/identity';
import { DEFAULT_ACTIVITY_LIMIT } from '../core/usecases/activity';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../core/model/workflow';
import {
  BASE_STYLES,
  baseStyleForSystem,
  baseStyleInfo,
  systemFor,
  templateFor,
} from '../core/citation/styles';
import { overrideObject } from '../core/citation/compile';
import { isCustomBaseStyleId } from '../core/citation/parse';
import type { BaseStyleSummary } from '../core/usecases/base-styles';
import type { MergeReport } from '../core/usecases/snapshot';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  ROLES,
  ROLE_LABELS,
  ROLE_SUMMARIES,
  can,
} from '../core/model/roles';
import { initialsOf, type MemberView } from '../core/usecases/members';
import { bytesToBase64 } from '../core/files/base64';
import {
  computeProgress,
  filterDocuments,
  statusCounts,
  type ListFilter,
} from '../sidepanel/view-model';
import {
  ACTIVITY_KIND_LABELS,
  ROUTE_TITLES,
  STATUS_META,
  activityFilterKinds,
  diffLabel,
  escapeHtml,
  groupActivityByDay,
  highlightEntity,
  isFullScreenRoute,
  isNavRoute,
  statusDot,
  statusLabel,
  type Route,
} from './view-model';
import { highlightJson } from './csl-code';
import { PREVIEW_SAMPLES, previewItems } from './preview-samples';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T =>
  root.querySelector(sel) as T;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => [
  ...root.querySelectorAll<T>(sel),
];
const esc = escapeHtml;

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
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 5h7a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5H2zM22 5h-7a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2.5H22z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  invite:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
};

/** Timeline dot glyph per activity kind (`comment` / `sync` land in M3 / M4). */
const ACTIVITY_ICON: Record<ActivityKind, string> = {
  source:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  status:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  annotation:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  comment:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.5A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/></svg>',
  reference:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  member:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.6-4.2M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.6 4.2"/><path d="M20 3v5h-5M4 21v-5h5"/></svg>',
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
  {
    id: 'team',
    label: 'Team',
    count: () => (state.members.length > 0 ? state.members.length : undefined),
    icon: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M17 11h6M20 8v6"/>',
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
  /** CSL styles the user imported, selectable as base styles. */
  baseStyles: BaseStyleSummary[];
  members: MemberView[];
  activity: ActivityEvent[];
  threads: CommentThread[];
  route: Route;
  flash: Id | null;
  drag: Id | null;
  docFilter: ListFilter;
  annoFilter: { search: string; status: AnnotationStatus | 'all' };
  selectedStyleId: Id | null;
  /** Right-hand panel tab in the full-screen style editor. */
  editorTab: 'preview' | 'csl';
  /** A snapshot chosen for import, held until the user confirms the plan. */
  pendingImport: { filename: string; content: string; password: string; report: MergeReport } | null;
  /** Tab within the Team view. */
  teamTab: 'activity' | 'comments' | 'members' | 'sync';
  activityFilter: ActivityKind | 'all';
  /** How many events the feed has asked for — grows with "Show older". */
  activityLimit: number;
}
const state: DashState = {
  projects: [],
  activeProjectId: null,
  documents: [],
  annotations: [],
  references: [],
  styles: [],
  baseStyles: [],
  members: [],
  activity: [],
  threads: [],
  route: 'overview',
  flash: null,
  drag: null,
  docFilter: { search: '', status: 'all' },
  annoFilter: { search: '', status: 'all' },
  selectedStyleId: null,
  editorTab: 'preview',
  pendingImport: null,
  teamTab: 'activity',
  activityFilter: 'all',
  activityLimit: DEFAULT_ACTIVITY_LIMIT,
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
    members: [{ userId: SELF_USER_ID, role: 'owner' }],
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
function defaultRules(
  system: CitationSystem,
  over: Partial<CitationUserRules> = {},
): CitationUserRules {
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
  {
    // Footnote profile — the base style has to be a note style for the system
    // to be real; `chicago` (author–date) would silently format in-text.
    id: 'chicago',
    name: 'Chicago (notes)',
    baseStyleId: 'chicago-note',
    userRules: defaultRules('footnote'),
  },
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
    state.members = [];
    state.activity = [];
    state.threads = [];
    return;
  }
  const projectId = state.activeProjectId;
  const [documents, annotations, references, styles, members, activity, threads, baseStyles] =
    await Promise.all([
    sendRequest({ type: 'documents/listByProject', projectId }),
    sendRequest({ type: 'annotations/listByProject', projectId }),
    sendRequest({ type: 'references/listByProject', projectId }),
    sendRequest({ type: 'citationStyles/list' }),
    sendRequest({ type: 'members/list', projectId }),
    sendRequest({ type: 'activity/listByProject', projectId, limit: state.activityLimit }),
    sendRequest({ type: 'comments/listByProject', projectId }),
    sendRequest({ type: 'baseStyles/list' }),
  ]);
  state.documents = documents;
  state.annotations = annotations;
  state.references = references;
  state.styles = styles;
  state.members = members;
  state.activity = activity;
  state.threads = threads;
  state.baseStyles = baseStyles;
}

/**
 * Make sure the local user has an identity row, so the Team view shows a name
 * instead of the bare `me` id. Runs once at start-up; never overwrites a name
 * the user already has.
 */
async function ensureSelfUser(): Promise<void> {
  const users = await sendRequest({ type: 'users/list' });
  if (users.some((u) => u.id === SELF_USER_ID)) return;
  await sendRequest({
    type: 'users/put',
    user: { id: SELF_USER_ID, name: 'You', rolesPerProject: {} },
  });
}

/** Reload just the member list — after an invite, role change or removal. */
async function reloadMembers(): Promise<void> {
  if (!state.activeProjectId) return;
  state.members = await sendRequest({ type: 'members/list', projectId: state.activeProjectId });
}

/** Reload the comment threads — after starting, replying, resolving or deleting. */
async function reloadThreads(): Promise<void> {
  if (!state.activeProjectId) return;
  state.threads = await sendRequest({
    type: 'comments/listByProject',
    projectId: state.activeProjectId,
  });
}

/** Reload the feed. Changes are recorded in the service worker, so the only way
 * to see one made in the Kanban, the side panel or the PDF reader is to re-read. */
async function reloadActivity(): Promise<void> {
  if (!state.activeProjectId) return;
  state.activity = await sendRequest({
    type: 'activity/listByProject',
    projectId: state.activeProjectId,
    limit: state.activityLimit,
  });
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
      if (r === 'team') void openTeam();
      else if (r && isNavRoute(r)) go(r);
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
        (
          pr,
        ) => `<button class="pmi${pr.id === state.activeProjectId ? ' active' : ''}" role="menuitem" data-p="${esc(pr.id)}">
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
  state.activityFilter = 'all';
  state.activityLimit = DEFAULT_ACTIVITY_LIMIT;
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
  styleEditor: renderStyleEditor,
  team: renderTeam,
};
function render(): void {
  // Full-screen workspaces drop the app shell (sidebar + credit footer) — the
  // same rule the PDF reader follows.
  $('.app').classList.toggle('editor-mode', isFullScreenRoute(state.route));
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
  return `<article class="kcard${state.flash === d.id ? ' flash' : ''}" draggable="true" data-id="${esc(d.id)}" tabindex="0" role="listitem" aria-label="${esc(title)} — ${label}. Arrow keys move between stages, Enter to change status.">
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
      if (!col.contains((e as DragEvent).relatedTarget as Node | null))
        col.classList.remove('drop');
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
      $<HTMLElement>(`#kanban .kcard[data-id="${CSS.escape(refocusId)}"]`)?.focus();
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
  const { template, styleId } = citeArgs();
  try {
    const bibliography = await sendRequest({
      type: 'citations/bibliography',
      projectId: state.activeProjectId,
      template,
      styleId,
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
  actions.innerHTML = `<button class="btn btn--primary btn--sm" id="addPdf">${ICON.up} Add PDF</button>`;
  $('#addPdf', actions).onclick = () => void addPdf();
  if (state.documents.length === 0) {
    view.innerHTML = emptyState(
      'No documents yet',
      'Add a PDF to read and annotate it, or capture a source with the side panel.',
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
      return `<tr data-id="${esc(d.id)}">
        <td><div class="ttl">${esc(m.title ?? d.url)}</div><div class="sub">${esc(sub)}</div></td>
        <td>${d.section ? `<span class="chip chip--sec">${esc(d.section)}</span>` : '<span class="mono">—</span>'}</td>
        <td><button class="spill" aria-label="Change status"><span class="d" style="background:${statusDot(d.status)}"></span>${statusLabel(d.status)}</button></td>
        <td class="num">${notes || '—'}</td>
        <td style="white-space:nowrap">
          ${canOpenInReader(d) ? `<button class="btn btn--ghost btn--sm" data-open title="Open in reader" aria-label="Open in reader">${ICON.open}</button>` : ''}
          ${m.doi ? `<a href="https://doi.org/${encodeURIComponent(m.doi)}" target="_blank" rel="noopener" title="Open source" aria-label="Open source">${ICON.ext}</a>` : ''}
        </td>
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
  $$('[data-open]', box).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.closest('tr')?.getAttribute('data-id');
      const doc = id ? docById(id) : undefined;
      if (doc) void openInReader(doc);
    });
  });
}

/* ---- PDF ingestion ---- */
function isPdfUrl(url: string): boolean {
  return /\.pdf($|\?|#)/i.test(url);
}
function canOpenInReader(d: Document): boolean {
  return d.type === 'pdf' || Boolean(d.fileId) || isPdfUrl(d.url);
}
function openReader(documentId: Id): void {
  window.open(
    chrome.runtime.getURL(`src/pdfviewer/index.html?documentId=${documentId}`),
    '_blank',
    'noopener',
  );
}
async function addPdf(): Promise<void> {
  if (!state.activeProjectId) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.onchange = () => void ingestFile(input.files?.[0]);
  input.click();
}
async function ingestFile(file: File | undefined): Promise<void> {
  if (!file || !state.activeProjectId) return;
  try {
    const buf = await file.arrayBuffer();
    const fileId = crypto.randomUUID();
    await sendRequest({
      type: 'files/put',
      file: {
        id: fileId,
        name: file.name,
        mime: file.type || 'application/pdf',
        dataBase64: bytesToBase64(buf),
      },
    });
    const now = nowIso();
    const doc: Document = {
      id: crypto.randomUUID(),
      projectId: state.activeProjectId,
      url: `file://${file.name}`,
      fileId,
      type: 'pdf',
      metadata: { title: file.name.replace(/\.pdf$/i, '') },
      status: 'toRead',
      createdAt: now,
      updatedAt: now,
    };
    await sendRequest({ type: 'documents/put', document: doc });
    await loadProjectData();
    render();
    toast('PDF added', ICON.check);
    openReader(doc.id);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not add PDF', ICON.warn, true);
  }
}
async function openInReader(d: Document): Promise<void> {
  if (d.fileId) {
    openReader(d.id);
    return;
  }
  if (!isPdfUrl(d.url)) {
    toast('No PDF file to open for this source', ICON.warn, true);
    return;
  }
  let origin: string;
  try {
    origin = `${new URL(d.url).origin}/*`;
  } catch {
    toast('Invalid PDF URL', ICON.warn, true);
    return;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    toast('Permission is needed to fetch the PDF', ICON.warn, true);
    return;
  }
  try {
    const res = await fetch(d.url);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const buf = await res.arrayBuffer();
    const fileId = crypto.randomUUID();
    await sendRequest({
      type: 'files/put',
      file: {
        id: fileId,
        name: d.url.split('/').pop() || 'document.pdf',
        mime: 'application/pdf',
        dataBase64: bytesToBase64(buf),
      },
    });
    const updated: Document = { ...d, fileId, type: 'pdf', updatedAt: nowIso() };
    await sendRequest({ type: 'documents/put', document: updated });
    state.documents = state.documents.map((x) => (x.id === d.id ? updated : x));
    toast('PDF cached', ICON.check);
    openReader(d.id);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Could not fetch PDF', ICON.warn, true);
  }
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
      return `<article class="anno" data-id="${esc(a.id)}">
        <div class="anno-top"><span class="anno-anchor">${esc(anchorLabel(a.anchor))}</span><span class="anno-src">${esc(srcLine)}</span></div>
        <div class="anno-body">${esc(a.content)}</div>
        <div class="anno-foot">
          <button class="stat-tag ${st.cls}" data-status aria-label="Change review status">${st.label}</button>
          ${a.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
          <button class="btn btn--ghost btn--sm" style="margin-left:auto" data-discuss="${esc(a.id)}">${ICON.note} Discuss</button>
          <button class="btn btn--ghost btn--sm" data-cite="${esc(a.documentId)}">${ICON.copy} Cite</button>
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
  $$('[data-discuss]', box).forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const anno = state.annotations.find((a) => a.id === b.dataset.discuss);
      if (anno) openDiscussPopover(b, anno);
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
  const { template, styleId } = citeArgs();
  try {
    const { bibliography } = await sendRequest({
      type: 'citations/document',
      documentId,
      template,
      styleId,
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
      return `<tr data-id="${esc(ref.id)}">
        <td><div class="ttl">${esc(line.title)}</div><div class="sub">${esc(line.sub)}</div>${line.doi ? `<div class="mono" style="margin-top:4px">doi:${esc(line.doi)}</div>` : ''}</td>
        <td><span class="chip chip--sec">${esc(cslTypeLabel(csl.type))}</span></td>
        <td><span class="stat-tag">${SOURCE_LABEL[ref.source]}</span></td>
        <td>${used}</td>
        <td><button class="btn btn--ghost btn--sm" data-cite="${esc(ref.id)}" aria-label="Copy citation">${ICON.copy}</button></td>
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
    origins: ['https://doi.org/*', 'https://data.crossref.org/*', 'https://data.datacite.org/*'],
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
/** Formatting arguments for the citation messages: the project's active style
 * profile, so its user rules shape the copied text, with the base template as
 * the fallback the service worker uses when no style id resolves. */
function citeArgs(): { template: string; styleId: Id | undefined } {
  const style = activeStyle();
  return { template: templateFor(style?.baseStyleId ?? 'apa'), styleId: style?.id };
}

async function copyReferenceCitation(referenceId: Id): Promise<void> {
  const { template, styleId } = citeArgs();
  try {
    const { bibliography } = await sendRequest({
      type: 'citations/reference',
      referenceId,
      template,
      styleId,
    });
    await navigator.clipboard.writeText(bibliography);
    toast('Citation copied', ICON.copy);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t copy citation', ICON.warn, true);
  }
}

/* ---- Citation styles ---- */
function selectedStyle(): CitationStyle | undefined {
  return state.styles.find((s) => s.id === state.selectedStyleId) ?? state.styles[0];
}

/** A detached copy, so edits in the editor never mutate the loaded state until saved. */
function cloneStyle(style: CitationStyle): CitationStyle {
  return { ...style, userRules: { ...style.userRules } };
}

type PreviewRow = { inText: string; bibliography: string };

/**
 * Paint a live preview of `style` into `host`. The formatting itself runs in
 * the service worker (`citations/preview`) through real citeproc, so what the
 * editor shows is exactly what a copied citation will say. Debounced, with a
 * sequence guard so a slow response can't overwrite a newer one.
 */
let previewSeq = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
function paintPreview(
  host: HTMLElement,
  style: CitationStyle,
  layout: (rows: PreviewRow[]) => string,
): void {
  const seq = ++previewSeq;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void sendRequest({ type: 'citations/preview', style: cloneStyle(style), items: previewItems() })
      .then((rows) => {
        if (seq === previewSeq) host.innerHTML = layout(rows);
      })
      .catch((err: unknown) => {
        if (seq !== previewSeq) return;
        const msg = err instanceof Error ? err.message : 'Preview unavailable';
        host.innerHTML = `<div class="pv-err">${esc(msg)}</div>`;
      });
  }, 120);
}

function systemLabel(system: CitationSystem): string {
  return system === 'footnote' ? 'Footnote' : system === 'numeric' ? 'Numeric' : 'Author–date';
}

function renderStyles(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = `<button class="btn btn--ghost btn--sm" id="sFull">Full editor</button><button class="btn btn--primary btn--sm" id="sSave">${ICON.check} Save profile</button>`;
  $('#sFull', actions).onclick = () => go('styleEditor');
  $('#sSave', actions).onclick = () => void saveStyle();

  if (state.styles.length === 0) {
    view.innerHTML = emptyState(
      'No citation styles',
      'Add a style profile to format your citations.',
    );
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
      (
        s,
      ) => `<button class="style-card${s.id === state.selectedStyleId ? ' sel' : ''}" data-s="${esc(s.id)}">
      <div class="snm">${esc(s.name)}</div>
      <div class="sb">${systemLabel(systemOfBase(s.baseStyleId))} · base ${esc(baseLabel(s.baseStyleId))}</div>
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
    <div class="ed-row"><div class="ed-lbl"><b>Base CSL style</b><span>Sets the citation system — ${esc(systemLabel(systemOfBase(style.baseStyleId)).toLowerCase())}</span></div>
      <select class="sel" id="baseSel" aria-label="Base CSL style">${baseOptions(style.baseStyleId)}</select></div>
    <div class="ed-row"><div class="ed-lbl"><b>Maximum authors</b><span>Before the list is truncated with “et al.”</span></div>
      <div class="stepper"><button data-step="-1" aria-label="Fewer">−</button><span class="val" id="maVal">${r.maxAuthors}</span><button data-step="1" aria-label="More">+</button></div></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include DOI</b><span>Append the DOI to bibliography entries</span></div>
      <button class="sw" role="switch" id="swDoi" aria-checked="${r.includeDoi}" aria-label="Include DOI"></button></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include URL</b><span>When no DOI is present</span></div>
      <button class="sw" role="switch" id="swUrl" aria-checked="${r.includeUrl}" aria-label="Include URL"></button></div>
    <div class="ed-row"><div class="ed-lbl"><b>Include issue number</b><span>Show the issue alongside the volume</span></div>
      <button class="sw" role="switch" id="swIssue" aria-checked="${r.includeIssue}" aria-label="Include issue number"></button></div>
    <div class="preview" id="cpreview"></div>`;
  $('#baseSel', editor).onchange = (e) => {
    setBaseStyle(style, (e.target as HTMLSelectElement).value);
    drawStyleList();
    drawStyleEditor();
  };
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

  const host = $('#cpreview', editor);
  host.innerHTML = `<div class="pl">Live preview · formatting…</div>`;
  paintPreview(
    host,
    style,
    (rows) =>
      `<div class="pl">Live preview · ${esc(style.name)} · ${esc(systemLabel(systemOfBase(style.baseStyleId)).toLowerCase())}</div>` +
      rows
        .map((row, i) => {
          const sample = PREVIEW_SAMPLES[i];
          if (!sample) return '';
          return `<div class="pex"><div class="pex-l">${esc(sample.label)}</div><div class="intxt">${esc(row.inText)}</div><div class="pv">${esc(row.bibliography)}</div></div>`;
        })
        .join(''),
  );
}

/** The citation system of any base style — vendored or imported. */
function systemOfBase(baseStyleId: string): CitationSystem {
  const imported = state.baseStyles.find((b) => b.id === baseStyleId);
  return imported ? imported.system : systemFor(baseStyleId);
}

/** Display label for any base style; an imported one that has been deleted
 * still names itself rather than showing a bare id. */
function baseLabel(baseStyleId: string): string {
  const imported = state.baseStyles.find((b) => b.id === baseStyleId);
  if (imported) return imported.name;
  if (isCustomBaseStyleId(baseStyleId)) return `${baseStyleId.split(':')[1] ?? baseStyleId} (missing)`;
  return baseStyleInfo(baseStyleId)?.label ?? baseStyleId;
}

/** `<option>` list for the base-style picker, with `selected` on the current one. */
function baseOptions(current: string): string {
  const option = (id: string, label: string): string =>
    `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(label)}</option>`;
  const vendored = BASE_STYLES.map((b) => option(b.id, b.label)).join('');
  const imported = state.baseStyles.map((b) => option(b.id, b.name)).join('');
  // A profile can outlive the imported style it was built on; keep it selectable
  // so the user sees what is wrong instead of the picker silently jumping to APA.
  const orphan =
    isCustomBaseStyleId(current) && !state.baseStyles.some((b) => b.id === current)
      ? option(current, baseLabel(current))
      : '';
  return (
    vendored +
    (imported ? `<optgroup label="Imported">${imported}${orphan}</optgroup>` : orphan)
  );
}

/** Switch the base style, keeping `userRules.system` truthful: the citation
 * system is declared by the CSL file, not chosen independently of it. */
function setBaseStyle(style: CitationStyle, baseStyleId: string): void {
  style.baseStyleId = baseStyleId;
  style.userRules.system = systemOfBase(baseStyleId);
}

async function saveStyle(): Promise<void> {
  const style = selectedStyle();
  if (!style) return;
  try {
    await sendRequest({
      type: 'citationStyles/put',
      style: { ...style, userRules: { ...style.userRules } },
    });
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
  await addStyle(style, 'New style created');
}

/** Copy the selected profile — the mock's "Duplicate" action. */
async function duplicateStyle(): Promise<void> {
  const base = selectedStyle();
  if (!base) return;
  await addStyle(
    { ...cloneStyle(base), id: crypto.randomUUID(), name: `${base.name} (copy)` },
    `Duplicated · ${base.name}`,
  );
}

async function addStyle(style: CitationStyle, message: string): Promise<void> {
  try {
    await sendRequest({ type: 'citationStyles/put', style });
    state.styles = [...state.styles, style];
    state.selectedStyleId = style.id;
    render();
    toast(message, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t create style', ICON.warn, true);
  }
}

async function deleteStyle(id: Id): Promise<void> {
  const style = state.styles.find((s) => s.id === id);
  if (!style) return;
  if (state.styles.length === 1) {
    toast('Keep at least one style profile', ICON.warn, true);
    return;
  }
  try {
    await sendRequest({ type: 'citationStyles/delete', id });
    state.styles = state.styles.filter((s) => s.id !== id);
    if (state.selectedStyleId === id) state.selectedStyleId = state.styles[0]?.id ?? null;
    render();
    toast(`Deleted · ${style.name}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t delete style', ICON.warn, true);
  }
}

/* ---- Citation styles: full-screen editor (Phase 4) ---- */

const RULE_ICON = {
  system: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  authors: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/>',
  identifiers:
    '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  formatting: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  special:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

function ruleGroup(icon: string, title: string, rows: string): string {
  return `<div class="grp">
    <div class="grp-h"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${icon}</svg><h2>${esc(title)}</h2><span class="ln"></span></div>
    ${rows}
  </div>`;
}
function ruleRow(title: string, help: string, control: string): string {
  return `<div class="row"><div class="rl"><b>${title}</b><span>${help}</span></div>${control}</div>`;
}
function toggle(id: string, on: boolean, label: string, disabled = false): string {
  return `<button class="sw" role="switch" id="${id}" aria-checked="${on}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}></button>`;
}
function stepper(key: string, value: number): string {
  return `<div class="stepper"><button data-step="${key}" data-d="-1" aria-label="Fewer">−</button><span class="val" id="v-${key}">${value}</span><button data-step="${key}" data-d="1" aria-label="More">+</button></div>`;
}

function renderStyleEditor(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML =
    `<button class="btn btn--ghost btn--sm" id="seBack">← Citation styles</button>` +
    `<button class="btn btn--sm" id="seDup">Duplicate</button>` +
    `<button class="btn btn--sm" id="seExport">${ICON.down} Export .csl</button>` +
    `<button class="btn btn--primary btn--sm" id="seSave">${ICON.check} Save</button>`;
  $('#seBack', actions).onclick = () => go('styles');
  $('#seDup', actions).onclick = () => void duplicateStyle();
  $('#seExport', actions).onclick = () => void exportStyleCsl();
  $('#seSave', actions).onclick = () => void saveStyle();

  if (state.styles.length === 0) {
    view.innerHTML = emptyState(
      'No citation styles',
      'Add a style profile to format your citations.',
    );
    return;
  }
  if (!state.selectedStyleId) state.selectedStyleId = state.styles[0]?.id ?? null;

  view.innerHTML = `<div class="sed">
    <aside class="sed-side" aria-label="Style profiles">
      <div class="sed-side-h">Style profiles</div>
      <div class="sed-plist" id="sedList"></div>
      <div class="sed-side-f"><button class="btn btn--sm" id="sedNew" style="width:100%">${ICON.plus} New style</button></div>
    </aside>
    <div class="sed-main">
      <header class="sed-head">
        <div class="h-name">
          <label for="sedName">Style name</label>
          <input class="name-in" id="sedName" aria-label="Style name" />
        </div>
        <div class="h-field">
          <label for="sedBase">Base CSL style</label>
          <div class="h-base">
            <select class="sel" id="sedBase"></select>
            <button class="btn btn--sm" id="sedImport" title="Import a .csl file as a base style">${ICON.up} Import .csl</button>
            <button class="btn btn--ghost btn--sm" id="sedDropBase" hidden
              title="Forget this imported style">${ICON.x}</button>
          </div>
        </div>
      </header>
      <div class="sed-work">
        <div class="sed-rules" id="sedRules"></div>
        <aside class="sed-panel">
          <div class="ptabs" role="tablist">
            <button class="ptab" id="tabPrev" role="tab">Live preview</button>
            <button class="ptab" id="tabCsl" role="tab">CSL override</button>
          </div>
          <div class="pbody" id="sedPanel"></div>
        </aside>
      </div>
    </div>
  </div>`;

  $('#sedNew', view).onclick = () => void createStyle();
  $('#tabPrev', view).onclick = () => {
    state.editorTab = 'preview';
    drawEditorPanel();
  };
  $('#tabCsl', view).onclick = () => {
    state.editorTab = 'csl';
    drawEditorPanel();
  };

  const name = $<HTMLInputElement>('#sedName', view);
  name.value = selectedStyle()?.name ?? '';
  name.oninput = () => {
    const style = selectedStyle();
    if (!style) return;
    style.name = name.value;
    drawEditorProfiles(); // keeps focus in the input — no full redraw
    drawEditorPanel();
  };

  $('#sedImport', view).onclick = () => pickBaseStyleFile();
  const dropBase = $('#sedDropBase', view);
  const currentBase = selectedStyle()?.baseStyleId ?? 'apa';
  dropBase.hidden = !isCustomBaseStyleId(currentBase);
  dropBase.onclick = () => void forgetBaseStyle(currentBase);

  const base = $<HTMLSelectElement>('#sedBase', view);
  base.innerHTML = baseOptions(currentBase);
  base.onchange = () => {
    const style = selectedStyle();
    if (!style) return;
    setBaseStyle(style, base.value);
    drawEditorProfiles();
    drawEditorRules();
    drawEditorPanel();
  };

  drawEditorProfiles();
  drawEditorRules();
  drawEditorPanel();
}

function drawEditorProfiles(): void {
  const host = $('#sedList');
  host.innerHTML = state.styles
    .map((s) => {
      const info = baseStyleInfo(s.baseStyleId);
      const baseShort = info?.label ?? baseLabel(s.baseStyleId);
      return `<div class="sed-pcard${s.id === state.selectedStyleId ? ' sel' : ''}">
        <button class="sed-pc-main" data-s="${esc(s.id)}">
          <div class="pn">${esc(s.name)}</div>
          <div class="pb"><span class="dot"></span>${esc(systemLabel(systemOfBase(s.baseStyleId)))} · ${esc(baseShort.split(' ')[0] ?? '')}</div>
        </button>
        <button class="sed-pc-del" data-del="${esc(s.id)}" aria-label="Delete ${esc(s.name)}" title="Delete profile">×</button>
      </div>`;
    })
    .join('');
  $$('[data-s]', host).forEach((b) => {
    b.onclick = () => {
      state.selectedStyleId = b.dataset.s ?? null;
      renderStyleEditor($('#view'), $('#viewActions'));
    };
  });
  $$('[data-del]', host).forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.del;
      if (id) void deleteStyle(id);
    };
  });
}

function drawEditorRules(): void {
  const style = selectedStyle();
  if (!style) return;
  const r = style.userRules;
  const system = systemOfBase(style.baseStyleId);
  const host = $('#sedRules');

  host.innerHTML =
    ruleGroup(
      RULE_ICON.system,
      'Citation system',
      ruleRow(
        'Format',
        'Declared by the base CSL style — switching here picks a matching style',
        `<div class="seg" id="segSys">
          <button data-v="authorDate" aria-pressed="${system === 'authorDate'}">Author–date</button>
          <button data-v="footnote" aria-pressed="${system === 'footnote'}">Footnote</button>
          <button data-v="numeric" aria-pressed="${system === 'numeric'}">Numeric</button>
        </div>`,
      ),
    ) +
    ruleGroup(
      RULE_ICON.authors,
      'Authors',
      ruleRow(
        'Maximum authors',
        `Show every name up to this count, then truncate → <code>et-al-min: ${r.maxAuthors + 1}</code>`,
        stepper('maxAuthors', r.maxAuthors),
      ) +
        ruleRow(
          'Names before “et al.”',
          'How many names to keep when truncating',
          stepper('etAlUseFirst', r.etAlUseFirst),
        ) +
        ruleRow(
          'Final name joiner',
          'Between the last two authors',
          `<div class="seg" id="segAnd"><button data-v="symbol" aria-pressed="${r.nameAnd === 'symbol'}">Ampersand&nbsp;&amp;</button><button data-v="text" aria-pressed="${r.nameAnd === 'text'}">Word “and”</button></div>`,
        ),
    ) +
    ruleGroup(
      RULE_ICON.identifiers,
      'Identifiers',
      ruleRow(
        'Include DOI',
        'Append the DOI to bibliography entries',
        toggle('swDoi', r.includeDoi, 'Include DOI'),
      ) +
        ruleRow(
          'DOI as full URL',
          '<code>https://doi.org/…</code> vs <code>doi:…</code>',
          toggle('swUri', r.doiAsUri, 'DOI as full URL', !r.includeDoi),
        ) +
        ruleRow(
          'Include URL when no DOI',
          'Fallback link for datasets &amp; web sources',
          toggle('swUrl', r.includeUrl, 'Include URL when no DOI'),
        ),
    ) +
    ruleGroup(
      RULE_ICON.formatting,
      'Formatting',
      ruleRow(
        'Include issue number',
        'Show <code>vol(issue)</code> vs volume only',
        toggle('swIssue', r.includeIssue, 'Include issue number'),
      ) +
        ruleRow(
          'Page range label',
          'Prepend <code>pp.</code> to page ranges',
          toggle('swPp', r.pagePrefix, 'Page range label'),
        ),
    ) +
    ruleGroup(
      RULE_ICON.special,
      'Special sources',
      ruleRow(
        'FOI request template',
        'Label FOI reports with the request descriptor and reference',
        toggle('swFoi', r.foiTemplate, 'FOI request template'),
      ) +
        ruleRow(
          'Legal case template',
          'Keep the neutral citation and the court',
          toggle('swLegal', r.legalTemplate, 'Legal case template'),
        ),
    );

  $$('#segSys button', host).forEach((b) => {
    b.onclick = () => {
      const next = b.dataset.v as CitationSystem;
      if (next === system) return;
      setBaseStyle(style, baseStyleForSystem(next));
      $<HTMLSelectElement>('#sedBase').value = style.baseStyleId;
      afterRuleChange();
    };
  });
  $$('#segAnd button', host).forEach((b) => {
    b.onclick = () => {
      r.nameAnd = b.dataset.v === 'text' ? 'text' : 'symbol';
      afterRuleChange();
    };
  });
  $$('[data-step]', host).forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.step as 'maxAuthors' | 'etAlUseFirst';
      r[key] = Math.max(1, Math.min(30, r[key] + Number(b.dataset.d)));
      if (r.etAlUseFirst > r.maxAuthors) r.etAlUseFirst = r.maxAuthors;
      afterRuleChange();
    };
  });
  const flip = (id: string, key: keyof CitationUserRules & string): void => {
    const el = $<HTMLButtonElement>(`#${id}`, host);
    if (!el || el.disabled) return;
    el.onclick = () => {
      (r[key] as boolean) = !r[key];
      afterRuleChange();
    };
  };
  flip('swDoi', 'includeDoi');
  flip('swUri', 'doiAsUri');
  flip('swUrl', 'includeUrl');
  flip('swIssue', 'includeIssue');
  flip('swPp', 'pagePrefix');
  flip('swFoi', 'foiTemplate');
  flip('swLegal', 'legalTemplate');
}

/** Redraw the rule column and the panel after any rule edit. */
function afterRuleChange(): void {
  drawEditorProfiles();
  drawEditorRules();
  drawEditorPanel();
}

function drawEditorPanel(): void {
  const style = selectedStyle();
  if (!style) return;
  const host = $('#sedPanel');
  const onPreview = state.editorTab === 'preview';
  $('#tabPrev').setAttribute('aria-selected', String(onPreview));
  $('#tabCsl').setAttribute('aria-selected', String(!onPreview));

  if (!onPreview) {
    const json = highlightJson(overrideObject(style.name, style.baseStyleId, style.userRules));
    host.innerHTML = `<div class="code"><div class="code-head"><span class="ct">${esc(style.baseStyleId)}.overrides.json</span></div><pre>${json}</pre></div>
      <div class="csl-note"><b>How this works.</b> These rules compile onto the base CSL style — name truncation and the joiner become CSL attributes, identifiers and special-source templates reshape the CSL-JSON item. The service worker formats through citeproc with the result, so no CSL XML is edited by hand. <b>Export .csl</b> saves the compiled style.</div>`;
    return;
  }

  host.innerHTML = `<div class="ex"><div class="ex-t">Formatting…</div></div>`;
  paintPreview(host, style, (rows) =>
    rows
      .map((row, i) => {
        const sample = PREVIEW_SAMPLES[i];
        if (!sample) return '';
        return `<div class="ex">
          <div class="ex-h"><span class="ex-type">${esc(sample.type)}</span><span class="ex-t">${esc(sample.label)}</span></div>
          <div class="ex-lbl">In-text</div><div class="ex-intext">${esc(row.inText)}</div>
          <div class="ex-lbl">Bibliography</div><div class="ex-bib">${esc(row.bibliography)}</div>
        </div>`;
      })
      .join(''),
  );
}

/** Download the compiled CSL for the selected profile. */
async function exportStyleCsl(): Promise<void> {
  const style = selectedStyle();
  if (!style) return;
  try {
    const csl = await sendRequest({ type: 'citations/compiledCsl', style: cloneStyle(style) });
    if (!csl) {
      toast('No CSL available for this base style', ICON.warn, true);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([csl], { type: 'application/vnd.citationstyles.style+xml' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${style.name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'style'}.csl`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported · ${a.download}`, ICON.down);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t export the style', ICON.warn, true);
  }
}

/* ---- Team: activity, members & roles (Phase 5) ---- */

/** Enter the Team view with a fresh feed — changes are made in other views. */
async function openTeam(): Promise<void> {
  go('team');
  try {
    await reloadActivity();
  } catch {
    // A stale feed is not worth a toast; the rest of the view still works.
    return;
  }
  if (state.route === 'team') render();
}

function renderTeam(view: HTMLElement, actions: HTMLElement): void {
  actions.innerHTML = `<button class="btn btn--primary btn--sm" id="tInvite">${ICON.invite} Invite</button>`;
  $('#tInvite', actions).onclick = (e) => {
    e.stopPropagation();
    // Inviting belongs to the Members tab — go there first, then open the form.
    if (state.teamTab !== 'members') {
      state.teamTab = 'members';
      render();
    }
    openInvitePopover($('#tInvite'));
  };

  const tab = (id: DashState['teamTab'], label: string, count: number): string =>
    `<button class="vtab" role="tab" data-tab="${id}" aria-selected="${state.teamTab === id}">
      ${label}<span class="n">${count}</span></button>`;

  // The Comments count is the open ones — a resolved thread is not a to-do.
  const openThreads = state.threads.filter((t) => !t.resolved).length;
  view.innerHTML = `
    <div class="vtabs" role="tablist">
      ${tab('activity', 'Activity', state.activity.length)}
      ${tab('comments', 'Comments', openThreads)}
      ${tab('members', 'Members', state.members.length)}
      <button class="vtab" role="tab" data-tab="sync" aria-selected="${state.teamTab === 'sync'}">Sync</button>
    </div>
    <div id="teamBody"></div>`;

  $$('.vtab', view).forEach((b) => {
    b.onclick = () => {
      const t = b.dataset.tab;
      if (t === 'activity' || t === 'comments' || t === 'members' || t === 'sync') {
        state.teamTab = t;
        render();
      }
    };
  });

  const body = $('#teamBody', view);
  if (state.teamTab === 'members') renderMembersTab(body);
  else if (state.teamTab === 'comments') renderCommentsTab(body);
  else if (state.teamTab === 'sync') renderSyncTab(body);
  else renderActivityTab(body);
}

function renderMembersTab(body: HTMLElement): void {
  const yes = `<span class="cap-y">${ICON.check}</span>`;
  const no = `<span class="cap-n">${ICON.x}</span>`;

  body.innerHTML = `
    <div class="advisory">${ICON.warn}<div><b>Roles are advisory.</b> Every collaborator holds a full
      copy of the project in their own browser, so a role documents intent — it is not enforced.
      Only a self-hosted backend could enforce it, and this build has no backend.</div></div>

    <div class="sec-h" style="margin-top:0"><h2>Members</h2><span class="ln"></span><span class="cnt">${state.members.length}</span></div>
    <div id="memList"></div>

    <div class="sec-h"><h2>What each role may do</h2><span class="ln"></span></div>
    <div class="matrix">
      <table class="tbl">
        <thead><tr><th>Capability</th>${ROLES.map((r) => `<th>${esc(ROLE_LABELS[r])}</th>`).join('')}</tr></thead>
        <tbody>${CAPABILITIES.map(
          (c) =>
            `<tr><td>${esc(CAPABILITY_LABELS[c])}</td>${ROLES.map(
              (r) => `<td class="cap">${can(r, c) ? yes : no}</td>`,
            ).join('')}</tr>`,
        ).join('')}</tbody>
      </table>
    </div>`;

  drawMembers();
}

/* ---- Team: activity feed ---- */

/** Who the event is attributed to. The local user is "You", not an id. */
function actorName(userId: Id): string {
  if (userId === SELF_USER_ID) return state.members.find((m) => m.userId === userId)?.name ?? 'You';
  return state.members.find((m) => m.userId === userId)?.name ?? userId;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

function activityEventHtml(event: ActivityEvent): string {
  const chip = (value: string, to = false): string =>
    `<span class="c${to ? ' to' : ''}">${esc(diffLabel(event.kind, value))}</span>`;
  const diff =
    event.from && event.to
      ? `<div class="diff">${chip(event.from)}<span class="ar">→</span>${chip(event.to, true)}</div>`
      : event.to
        ? `<div class="diff">${chip(event.to, true)}</div>`
        : '';
  return `<div class="ev">
    <div class="ev-dot ${event.kind}">${ACTIVITY_ICON[event.kind]}</div>
    <div class="ev-b">
      <span class="who">${esc(actorName(event.actorUserId))}</span>
      ${highlightEntity(event.summary, event.entityLabel)}${diff}
      <div class="ev-t">${esc(timeLabel(event.createdAt))}</div>
    </div>
  </div>`;
}

function renderActivityTab(body: HTMLElement): void {
  const kinds = activityFilterKinds(state.activity);
  // A filter can outlive the events it matched (project switch, "Show older").
  if (state.activityFilter !== 'all' && !kinds.includes(state.activityFilter)) {
    state.activityFilter = 'all';
  }
  const events =
    state.activityFilter === 'all'
      ? state.activity
      : state.activity.filter((e) => e.kind === state.activityFilter);

  const chip = (value: ActivityKind | 'all', label: string): string =>
    `<button class="fchip" data-af="${value}" aria-pressed="${state.activityFilter === value}">${esc(label)}</button>`;
  const filters =
    kinds.length > 1
      ? `<div class="filters" id="actFilters" style="margin-bottom:18px">
          ${chip('all', 'All')}${kinds.map((k) => chip(k, ACTIVITY_KIND_LABELS[k])).join('')}
        </div>`
      : '';

  const feed = groupActivityByDay(events, nowIso())
    .map(
      (day) => `<div class="day">${esc(day.label)}<span class="ln"></span></div>
        <div class="feed">${day.events.map(activityEventHtml).join('')}</div>`,
    )
    .join('');

  // The feed reads a page at a time; a full page means there may be more.
  const older =
    state.activity.length >= state.activityLimit
      ? `<div class="more"><button class="btn btn--ghost btn--sm" id="actOlder">Show older</button></div>`
      : '';

  body.innerHTML =
    filters +
    (events.length === 0
      ? emptyState(
          'Nothing recorded yet',
          'Move a source, write a note or invite a collaborator — every change lands here.',
        )
      : feed + older);

  $$('[data-af]', body).forEach((b) => {
    b.onclick = () => {
      const value = b.dataset.af;
      state.activityFilter = value === 'all' ? 'all' : (value as ActivityKind);
      render();
    };
  });
  const olderBtn = body.querySelector<HTMLButtonElement>('#actOlder');
  if (olderBtn) olderBtn.onclick = () => void showOlderActivity();
}

/* ---- Imported base styles ---- */

function pickBaseStyleFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csl,application/xml,text/xml';
  input.onchange = () => void importBaseStyle(input.files?.[0]);
  input.click();
}

async function importBaseStyle(file: File | undefined): Promise<void> {
  if (!file) return;
  try {
    const imported = await sendRequest({ type: 'baseStyles/import', xml: await file.text() });
    state.baseStyles = await sendRequest({ type: 'baseStyles/list' });
    const style = selectedStyle();
    if (style) {
      setBaseStyle(style, imported.id);
      await saveStyle();
    }
    render();
    toast(`Imported · ${imported.name}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t import that style', ICON.warn, true);
  }
}

/**
 * Forget an imported base style. Profiles built on it keep pointing at it and
 * say so in the picker — deleting a user's profiles would be the worse surprise.
 */
async function forgetBaseStyle(id: Id): Promise<void> {
  const name = baseLabel(id);
  try {
    await sendRequest({ type: 'baseStyles/delete', id });
    state.baseStyles = await sendRequest({ type: 'baseStyles/list' });
    render();
    toast(`Forgot · ${name}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t forget that style', ICON.warn, true);
  }
}

/* ---- Team: sync & snapshots (Phase 5, M4) ---- */

const SYNC_MODES: Array<{ id: SyncMode | 'backend'; label: string; sub: string }> = [
  {
    id: 'local',
    label: 'Local only',
    sub: 'Data stays in this browser’s IndexedDB. Nothing leaves the machine.',
  },
  {
    id: 'file',
    label: 'File-based (shared drive)',
    sub: 'A portable snapshot, optionally encrypted, shared through a drive or a network share. Merge on import.',
  },
  {
    id: 'backend',
    label: 'Self-hosted backend',
    sub: 'Real-time sync with enforced roles — needs a server. Not part of this build.',
  },
];

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSyncTab(body: HTMLElement): void {
  const project = activeProject();
  const mode: SyncMode = project?.syncMode ?? 'local';
  const pdfCount = state.documents.filter((d) => d.fileId).length;

  body.innerHTML = `
    <div class="sec-h" style="margin-top:0"><h2>Sync mode</h2><span class="ln"></span></div>
    <div class="modes">
      ${SYNC_MODES.map((m) => {
        const unavailable = m.id === 'backend';
        return `<button class="mode${!unavailable && m.id === mode ? ' on' : ''}${unavailable ? ' off' : ''}"
          data-mode="${m.id}"${unavailable ? ' disabled aria-disabled="true"' : ''}
          aria-pressed="${!unavailable && m.id === mode}">
          <span class="mode-b">${esc(m.label)}${unavailable ? '<span class="badge-pend">Unavailable</span>' : ''}</span>
          <span class="mode-s">${esc(m.sub)}</span>
        </button>`;
      }).join('')}
    </div>

    <div class="sec-h"><h2>Export a snapshot</h2><span class="ln"></span></div>
    <div class="panel">
      <p class="panel-note">Everything in this project — sources, notes, references, styles, people,
        history and discussion — as one JSON file. Leave the password empty for plain JSON you can
        read and diff; set one and the file is encrypted with AES-GCM.</p>
      <div class="row">
        <input id="expPass" class="sel" type="password" placeholder="Password (optional)"
          aria-label="Snapshot password" style="width:220px">
        <label class="check"><input type="checkbox" id="expFiles"${pdfCount === 0 ? ' disabled' : ''}>
          Include PDF files${pdfCount > 0 ? ` (${pdfCount})` : ''}</label>
        <button class="btn btn--primary btn--sm" id="expGo">${ICON.down} Export</button>
      </div>
      <p class="panel-note">PDF bytes are left out by default — they dwarf everything else, and a
        snapshot you cannot send is not a way of sharing work.</p>
    </div>

    <div class="sec-h"><h2>Import a snapshot</h2><span class="ln"></span></div>
    <div class="panel">
      <p class="panel-note">Merges into this browser. <b>References and sources deduplicate by
        DOI</b>; everything else merges by id, and the newer record wins. Nothing is deleted.</p>
      <div class="row">
        <input id="impPass" class="sel" type="password" placeholder="Password (if encrypted)"
          aria-label="Password for the snapshot being imported" style="width:220px">
        <button class="btn btn--sm" id="impGo">${ICON.up} Choose a file…</button>
      </div>
      ${state.pendingImport ? importPlanHtml(state.pendingImport) : ''}
    </div>`;

  $$('[data-mode]', body).forEach((b) => {
    b.onclick = () => {
      const value = b.dataset.mode;
      if (value === 'local' || value === 'file') void setSyncMode(value);
    };
  });
  $('#expGo', body).onclick = () => void exportSnapshot();
  $('#impGo', body).onclick = () => pickSnapshotFile();
  if (state.pendingImport) {
    $('#impConfirm', body).onclick = () => void confirmImport();
    $('#impCancel', body).onclick = () => cancelImport();
  }
}

async function setSyncMode(mode: SyncMode): Promise<void> {
  const project = activeProject();
  if (!project || (project.syncMode ?? 'local') === mode) return;
  const updated: Project = { ...project, syncMode: mode, updatedAt: nowIso() };
  try {
    await sendRequest({ type: 'projects/put', project: updated });
    state.projects = state.projects.map((p) => (p.id === updated.id ? updated : p));
    render();
    toast(`Sync mode · ${mode === 'file' ? 'File-based' : 'Local only'}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t change the sync mode', ICON.warn, true);
  }
}

async function exportSnapshot(): Promise<void> {
  if (!state.activeProjectId) return;
  const password = $<HTMLInputElement>('#expPass')?.value ?? '';
  const includeFiles = $<HTMLInputElement>('#expFiles')?.checked === true;
  try {
    const snapshot = await sendRequest({
      type: 'snapshot/export',
      projectId: state.activeProjectId,
      includeFiles,
      password,
    });
    const url = URL.createObjectURL(new Blob([snapshot.content], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = snapshot.filename;
    a.click();
    URL.revokeObjectURL(url);
    await reloadActivity();
    render();
    toast(
      `Exported · ${snapshot.filename} (${humanSize(snapshot.bytes)}${password ? ', encrypted' : ''})`,
      ICON.down,
    );
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t export the snapshot', ICON.warn, true);
  }
}

function pickSnapshotFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => void importSnapshot(input.files?.[0]);
  input.click();
}

/**
 * Choosing a file does not import it: the snapshot is read, planned against
 * what is already here, and the plan shown. A merge is hard to undo, so the
 * user sees the numbers before anything is written.
 */
async function importSnapshot(file: File | undefined): Promise<void> {
  if (!file) return;
  const password = $<HTMLInputElement>('#impPass')?.value ?? '';
  try {
    const content = await file.text();
    const report = await sendRequest({ type: 'snapshot/preview', content, password });
    state.pendingImport = { filename: file.name, content, password, report };
    render();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t read that snapshot', ICON.warn, true);
  }
}

async function confirmImport(): Promise<void> {
  const pending = state.pendingImport;
  if (!pending) return;
  try {
    const report = await sendRequest({
      type: 'snapshot/import',
      content: pending.content,
      password: pending.password,
    });
    state.pendingImport = null;
    await loadProjectData();
    render();
    const merged =
      report.documents + report.annotations + report.references + report.commentThreads;
    toast(
      `Imported ${report.projectName} · ${merged} records` +
        (report.dedupedByDoi > 0 ? ` · ${report.dedupedByDoi} deduped by DOI` : ''),
      ICON.check,
    );
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t import the snapshot', ICON.warn, true);
  }
}

function cancelImport(): void {
  state.pendingImport = null;
  render();
}

/** The plan, in words. Zero rows are dropped — they are noise, not information. */
function importPlanHtml(pending: NonNullable<DashState['pendingImport']>): string {
  const r = pending.report;
  const rows: Array<[string, number]> = [
    ['Sources', r.documents],
    ['Annotations', r.annotations],
    ['References', r.references],
    ['Comment threads', r.commentThreads],
    ['Citation styles', r.citationStyles],
    ['People', r.users],
    ['History events', r.activity],
    ['PDF files', r.files],
  ];
  const written = rows.filter(([, n]) => n > 0);
  const nothing = written.length === 0 && r.dedupedByDoi === 0 && r.skippedOlder === 0;

  return `<div class="plan">
    <div class="plan-h">
      <b>${r.newProject ? 'Create' : 'Merge into'} ${esc(r.projectName)}</b>
      <span class="plan-file">${esc(pending.filename)}</span>
    </div>
    ${
      nothing
        ? `<p class="panel-note">Everything in this snapshot is already here — importing it would change nothing.</p>`
        : `<ul class="plan-list">
            ${written.map(([label, n]) => `<li><span class="n">+${n}</span> ${esc(label)}</li>`).join('')}
            ${r.dedupedByDoi > 0 ? `<li class="muted"><span class="n">${r.dedupedByDoi}</span> folded into records already here, by DOI</li>` : ''}
            ${r.skippedOlder > 0 ? `<li class="muted"><span class="n">${r.skippedOlder}</span> skipped — your copy is newer</li>` : ''}
          </ul>
          <p class="panel-note">Nothing is deleted by an import.</p>`
    }
    <div class="row">
      <button class="btn btn--primary btn--sm" id="impConfirm"${nothing ? ' disabled' : ''}>${ICON.check} Import</button>
      <button class="btn btn--ghost btn--sm" id="impCancel">Cancel</button>
    </div>
  </div>`;
}

/* ---- Team: comment threads (Phase 5, M3) ---- */

function commentHtml(comment: CommentThread['comments'][number]): string {
  const who = actorName(comment.authorId);
  return `<div class="cm">
    <span class="cm-av">${esc(initialsOf(who))}</span>
    <div class="cm-b">
      <div class="cm-h"><b>${esc(who)}</b><span class="t">${esc(timeLabel(comment.createdAt))}</span></div>
      <div class="cm-txt">${esc(comment.body)}</div>
    </div>
  </div>`;
}

function threadHtml(thread: CommentThread): string {
  const source = thread.documentId ? docById(thread.documentId) : undefined;
  const title = source?.metadata.title;
  const quote = thread.quote ?? title;
  return `<div class="thread${thread.resolved ? ' resolved' : ''}" data-t="${esc(thread.id)}">
    <div class="th-h">
      <span class="anchor">${esc(thread.anchorLabel)}</span>
      <span class="th-q">${quote ? `“${esc(quote)}”` : ''}</span>
      <button class="resolve${thread.resolved ? ' done' : ''}" data-res="${esc(thread.id)}">
        ${thread.resolved ? `${ICON.check}Resolved` : 'Resolve'}</button>
      <button class="btn btn--ghost btn--sm" data-delthread="${esc(thread.id)}"
        aria-label="Delete this thread">${ICON.x}</button>
    </div>
    <div class="comments">${thread.comments.map(commentHtml).join('')}</div>
    ${
      thread.resolved
        ? ''
        : `<div class="reply">
            <input data-reply="${esc(thread.id)}" placeholder="Reply to the thread…" aria-label="Reply to the thread">
            <button class="btn btn--primary btn--sm" data-post="${esc(thread.id)}">Post</button>
          </div>`
    }
  </div>`;
}

function renderCommentsTab(body: HTMLElement): void {
  if (state.threads.length === 0) {
    body.innerHTML = emptyState(
      'No discussions yet',
      'Start one from a note — Annotations → Discuss — and the thread appears here.',
    );
    return;
  }
  body.innerHTML = state.threads.map(threadHtml).join('');

  $$('[data-res]', body).forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.res;
      const thread = state.threads.find((t) => t.id === id);
      if (thread) void setResolved(thread.id, !thread.resolved);
    };
  });
  $$('[data-post]', body).forEach((b) => {
    b.onclick = () => void postReply(b.dataset.post ?? '');
  });
  $$('[data-delthread]', body).forEach((b) => {
    b.onclick = () => void removeThread(b.dataset.delthread ?? '');
  });
  $$<HTMLInputElement>('[data-reply]', body).forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void postReply(input.dataset.reply ?? '');
      }
    });
  });
}

/** Refresh threads and feed together — every thread change writes an event. */
async function reloadDiscussion(): Promise<void> {
  await Promise.all([reloadThreads(), reloadActivity()]);
}

async function postReply(threadId: Id): Promise<void> {
  const input = $<HTMLInputElement>(`[data-reply="${CSS.escape(threadId)}"]`);
  const body = input?.value.trim() ?? '';
  if (!body) return;
  try {
    await sendRequest({ type: 'comments/reply', threadId, body });
    await reloadDiscussion();
    render();
    // The re-render replaced the input, so focus the new one.
    $<HTMLInputElement>(`[data-reply="${CSS.escape(threadId)}"]`)?.focus();
    toast('Comment posted', ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t post the comment', ICON.warn, true);
  }
}

async function setResolved(threadId: Id, resolved: boolean): Promise<void> {
  try {
    await sendRequest({ type: 'comments/setResolved', threadId, resolved });
    await reloadDiscussion();
    render();
    toast(resolved ? 'Thread resolved' : 'Thread reopened', ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t update the thread', ICON.warn, true);
  }
}

async function removeThread(threadId: Id): Promise<void> {
  try {
    await sendRequest({ type: 'comments/delete', threadId });
    await reloadDiscussion();
    render();
    toast('Thread deleted', ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t delete the thread', ICON.warn, true);
  }
}

/** Start a thread on an annotation, from the Annotations view. */
function openDiscussPopover(anchor: HTMLElement, annotation: Annotation): void {
  const pop = $('#pop');
  pop.innerHTML = `<div class="pl">Start a discussion</div>
    <div class="pop-form">
      <input id="thBody" class="sel" type="text" placeholder="What is worth asking here?"
        aria-label="First comment" style="width:260px">
      <button class="btn btn--primary btn--sm" id="thGo">${ICON.check} Post</button>
    </div>
    <div class="pop-note">The thread is anchored to this note and opens in Team → Comments.</div>`;
  const input = $<HTMLInputElement>('#thBody', pop);
  const submit = (): void => void startDiscussion(annotation, input.value);
  $('#thGo', pop).onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  placePop(anchor);
  input.focus();
}

async function startDiscussion(annotation: Annotation, body: string): Promise<void> {
  if (!body.trim()) return;
  try {
    await sendRequest({
      type: 'comments/start',
      input: {
        projectId: annotation.projectId,
        annotationId: annotation.id,
        anchorLabel: anchorLabel(annotation.anchor),
        body: body.trim(),
      },
    });
    closePop();
    await reloadDiscussion();
    render();
    toast('Thread started · Team → Comments', ICON.note);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t start the thread', ICON.warn, true);
  }
}

async function showOlderActivity(): Promise<void> {
  const before = state.activity.length;
  state.activityLimit += DEFAULT_ACTIVITY_LIMIT;
  await reloadActivity();
  render();
  if (state.activity.length === before) toast('That is the whole history', ICON.check);
}

function drawMembers(): void {
  const host = $('#memList');
  if (state.members.length === 0) {
    host.innerHTML = emptyState('No members yet', 'Invite a collaborator to share this project.');
    return;
  }
  host.innerHTML = state.members
    .map((m) => {
      const owners = state.members.filter((x) => x.role === 'owner' && !x.pending).length;
      const lastOwner = m.role === 'owner' && !m.pending && owners === 1;
      const roleControl = lastOwner
        ? `<span class="stat-tag rep" title="A project must keep at least one owner">Owner</span>`
        : `<select class="sel" data-role="${esc(m.userId)}" aria-label="Role for ${esc(m.name)}">${ROLES.map(
            (r) =>
              `<option value="${r}"${r === m.role ? ' selected' : ''}>${esc(ROLE_LABELS[r])}</option>`,
          ).join('')}</select>`;
      return `<div class="mem" data-m="${esc(m.userId)}">
        <span class="mem-av">${esc(m.initials)}</span>
        <div class="mem-who">
          <b>${esc(m.name)}${m.pending ? '<span class="badge-pend">Invited</span>' : ''}</b>
          <span>${esc(m.email ?? ROLE_SUMMARIES[m.role])}</span>
        </div>
        ${roleControl}
        ${lastOwner ? '' : `<button class="btn btn--ghost btn--sm" data-rm="${esc(m.userId)}" aria-label="Remove ${esc(m.name)}">${ICON.x}</button>`}
      </div>`;
    })
    .join('');

  $$('[data-role]', host).forEach((el) => {
    const select = el as HTMLSelectElement;
    select.onchange = () => void changeRole(select.dataset.role ?? '', select.value as ProjectRole);
  });
  $$('[data-rm]', host).forEach((b) => {
    b.onclick = () => void removeMemberById(b.dataset.rm ?? '');
  });
}

function openInvitePopover(anchor: HTMLElement): void {
  const pop = $('#pop');
  pop.innerHTML = `<div class="pl">Invite a collaborator</div>
    <div class="pop-form">
      <input id="invEmail" class="sel" type="email" placeholder="name@institution.edu" aria-label="Email address" style="width:220px">
      <select id="invRole" class="sel" aria-label="Role">${ROLES.filter((r) => r !== 'owner')
        .map((r) => `<option value="${r}">${esc(ROLE_LABELS[r])}</option>`)
        .join('')}</select>
      <button class="btn btn--primary btn--sm" id="invGo">${ICON.check} Invite</button>
    </div>
    <div class="pop-note">Nothing is sent — the invitation travels in the next snapshot you share.</div>`;
  const input = $<HTMLInputElement>('#invEmail', pop);
  const submit = (): void =>
    void invite(input.value, $<HTMLSelectElement>('#invRole', pop).value as ProjectRole);
  $('#invGo', pop).onclick = submit;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  placePop(anchor);
  input.focus();
}

async function invite(email: string, role: ProjectRole): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const member = await sendRequest({
      type: 'members/invite',
      projectId: state.activeProjectId,
      email: email.trim(),
      role,
    });
    closePop();
    await Promise.all([reloadMembers(), reloadActivity()]);
    render();
    toast(`Invited · ${member.name} as ${ROLE_LABELS[member.role]}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t invite', ICON.warn, true);
  }
}

async function changeRole(userId: Id, role: ProjectRole): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    await sendRequest({ type: 'members/setRole', projectId: state.activeProjectId, userId, role });
    await Promise.all([reloadMembers(), reloadActivity()]);
    render();
    toast(`Role updated to ${ROLE_LABELS[role]}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t change the role', ICON.warn, true);
    await reloadMembers();
    render();
  }
}

async function removeMemberById(userId: Id): Promise<void> {
  if (!state.activeProjectId) return;
  const member = state.members.find((m) => m.userId === userId);
  try {
    await sendRequest({ type: 'members/remove', projectId: state.activeProjectId, userId });
    await Promise.all([reloadMembers(), reloadActivity()]);
    render();
    toast(`Removed · ${member?.name ?? userId}`, ICON.check);
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t remove the member', ICON.warn, true);
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
/**
 * `msg` is plain text and is escaped here — callers must **not** pre-escape it,
 * or a project called "Ecology & Society" reads as "Ecology &amp; Society".
 * `icon` is markup and comes only from the `ICON` table, never from data.
 */
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
    await ensureSelfUser();
    await loadProjectData();
    await ensureSeedStyles();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to load projects', ICON.warn, true);
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => void init());
