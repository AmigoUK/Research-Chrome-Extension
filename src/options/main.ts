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
import type { Project, Document, Id } from '../core/model/types';
import { ROUTE_TITLES, isRoute, type Route } from './view-model';

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
    count: () => undefined,
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  },
  {
    id: 'references',
    label: 'References',
    count: () => state.documents.length,
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  },
  {
    id: 'styles',
    label: 'Citation styles',
    count: () => undefined,
    icon: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  },
];

/* ---- State ---- */
interface DashState {
  projects: Project[];
  activeProjectId: Id | null;
  documents: Document[];
  route: Route;
}
const state: DashState = { projects: [], activeProjectId: null, documents: [], route: 'overview' };

const activeProject = (): Project | undefined =>
  state.projects.find((p) => p.id === state.activeProjectId);

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
async function loadDocuments(): Promise<void> {
  state.documents = state.activeProjectId
    ? await sendRequest({ type: 'documents/listByProject', projectId: state.activeProjectId })
    : [];
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
  await loadDocuments();
  render();
}
async function createProject(): Promise<void> {
  const project = makeProject(`Project ${state.projects.length + 1}`);
  await sendRequest({ type: 'projects/put', project });
  state.projects = [...state.projects, project];
  state.activeProjectId = project.id;
  await loadDocuments();
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
  documents: (v) =>
    placeholder(v, 'Workflow board', 'The Kanban board and project stats land in the next milestone.'),
  annotations: (v) => placeholder(v, 'Annotations', 'Notes across the project will collect here.'),
  references: (v) => placeholder(v, 'References', 'Bibliographic records and DOI import arrive soon.'),
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

/* ---- Views (M1 scaffolds) ---- */
function renderOverview(view: HTMLElement): void {
  const p = activeProject();
  const n = state.documents.length;
  view.innerHTML = `<div class="empty">
    <div class="em"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20"><path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/></svg></div>
    <div class="et">${esc(p?.name ?? 'Your research project')}</div>
    <div class="ed">${n} source${n === 1 ? '' : 's'} · ${p?.sections.length ?? 0} sections. The workflow board and project stats arrive in the next milestone.</div>
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
    await loadDocuments();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to load projects', ICON.warn, true);
  }
  render();
}

document.addEventListener('DOMContentLoaded', () => void init());
