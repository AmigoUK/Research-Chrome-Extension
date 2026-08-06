/**
 * Side panel entry point. Wires the ported UI to the service worker over the
 * typed messaging layer, and to the active tab for capture.
 */
import './panel.css';
import { CLIENT_ID, sendRequest } from '../adapters/chrome/messaging';
import {
  scanActiveTab,
  captureActiveTab,
  hasStandingPageAccess,
  requestStandingPageAccess,
  ScanAccessError,
} from '../adapters/chrome/capture';
import { buildCaptureInput } from '../adapters/chrome/page-scan';
import { isSearchPage } from '../core/extract/metadata';
import { getActiveProjectId, setActiveProjectId } from '../adapters/chrome/active-project';
import { requestDoiAccess } from '../adapters/chrome/doi-access';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../core/model/workflow';
import type {
  Annotation,
  AnnotationStatus,
  CitationStyle,
  Document,
  HighlightColor,
  Id,
  OutlineSection,
  Project,
  TextQuoteSelector,
} from '../core/model/types';
import { templateFor } from '../core/citation/styles';
import { defaultOutline, resolveOutline } from '../core/draft/outline';
import type { CaptureInput } from '../core/usecases/capture';
import {
  STATUS_META,
  statusLabel,
  statusCounts,
  filterDocuments,
  groupByStatus,
  computeProgress,
  gettingStartedSteps,
  gettingStartedComplete,
  type ListFilter,
} from './view-model';
import {
  getOnboardingState,
  dismissGettingStarted,
  markCitationCopied,
} from '../adapters/chrome/onboarding-state';
import { getUpdateNotice, dismissUpdateNotice } from '../adapters/chrome/update-notice';
import { onPageSignature } from './on-page-signature';

interface State {
  projects: Project[];
  activeProjectId: string | null;
  documents: Document[];
  styles: CitationStyle[];
  filter: ListFilter;
  preview: CaptureInput | null;
  /** The previewed page is a search/results surface — filing it would store
   *  the query string as a "source". The File button is disabled with an
   *  explanation instead. */
  previewIsSearchPage: boolean;
  /** Chrome refused to read the active tab (activeTab grant spent or never
   *  given). Shown as its own honest state — NOT "no page metadata". */
  previewBlocked: boolean;
  /** The user granted the standing read-pages permission — the annotator can
   *  auto-activate and "select text to highlight" is literally true. */
  standingAccess: boolean;
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
  /** Getting-started checklist inputs the documents list cannot prove. */
  annotationCount: number;
  /** At least one of the project's annotations carries a section. */
  hasSectionedAnnotation: boolean;
  copiedCitation: boolean;
  gettingStartedDismissed: boolean;
}

const state: State = {
  projects: [],
  activeProjectId: null,
  documents: [],
  styles: [],
  filter: { search: '', status: 'all' },
  preview: null,
  previewIsSearchPage: false,
  previewBlocked: false,
  standingAccess: false,
  filedReferenceId: null,
  filedUrl: null,
  pageAnnotations: [],
  pageDocumentId: null,
  resolvedIds: new Set(),
  annotationCount: 0,
  hasSectionedAnnotation: false,
  copiedCitation: false,
  gettingStartedDismissed: true, // hidden until storage says otherwise
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

/** `resolveOutline` needs a `Project`; before one has loaded (or a fresh
 *  profile with none yet), the picker still needs options to show — the same
 *  defaults `resolveOutline` itself falls back to for a project with no
 *  outline of its own. */
function currentOutline(): OutlineSection[] {
  const project = activeProject();
  return project ? resolveOutline(project) : defaultOutline();
}

/**
 * The style the panel cites with. Mirrors the dashboard's `activeStyle`: the
 * project's configured default, else the first style. The panel used to hardcode
 * APA, silently ignoring whatever style the user had set up in the dashboard.
 */
function activeStyle(): CitationStyle | undefined {
  return (
    state.styles.find((s) => s.id === activeProject()?.defaultCitationStyleId) ?? state.styles[0]
  );
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
      outline: defaultOutline(),
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

/** The active project's highlight legend (defaults when unset). */
let palette: HighlightColor[] = [];
async function loadPalette(): Promise<void> {
  try {
    palette = await sendRequest({ type: 'palette/get', projectId: state.activeProjectId ?? '' });
  } catch {
    palette = [];
  }
}
function paletteEntry(colorId: string | undefined): HighlightColor | undefined {
  return colorId ? palette.find((c) => c.id === colorId) : undefined;
}

async function loadAnnotationCount(): Promise<void> {
  if (!state.activeProjectId) {
    state.annotationCount = 0;
    state.hasSectionedAnnotation = false;
    return;
  }
  try {
    const annotations = await sendRequest({
      type: 'annotations/listByProject',
      projectId: state.activeProjectId,
    });
    state.annotationCount = annotations.length;
    // Project-wide, not just this page's: the checklist's Outline step must
    // reflect a section assigned from the dashboard just as much as one
    // assigned from this panel's own picker.
    state.hasSectionedAnnotation = annotations.some((a) => a.section !== undefined);
  } catch {
    // The checklist is decoration; a failed count must not break the panel.
  }
}

async function loadPreview(): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const scan = await scanActiveTab();
    state.preview = buildCaptureInput(scan, state.activeProjectId);
    state.previewIsSearchPage = isSearchPage(scan.url, scan.raw.metaTags ?? {});
    state.previewBlocked = false;
  } catch (err) {
    state.preview = null;
    state.previewIsSearchPage = false;
    state.previewBlocked = err instanceof ScanAccessError;
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
  // Clicking into the panel raises window focus, which lands here. Repainting
  // then would replace the very textarea the reader just clicked into.
  if (isEditingNote()) return;
  await loadPreview();
  await loadPageAnnotations();
  renderCaptureCard();
  renderOnPageCard();
  renderGettingStarted(); // its first step tracks the previewed tab
  // With the standing grant, "select text to highlight" must be literally
  // true — inject the annotator on the page being previewed, silently.
  // Re-injection is idempotent (the annotator guards itself) and failures
  // (chrome:// pages, the Web Store) are simply pages that cannot be
  // annotated, so auto mode never toasts.
  if (state.standingAccess && isCapturablePreview() && !state.previewIsSearchPage) {
    chrome.runtime.sendMessage({ control: 'annotator/activate' }).catch(() => {});
  }
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function renderHeader(): void {
  const project = activeProject();
  $('activeName').textContent = project?.name ?? '—';
  $('activeSub').textContent = project ? `${state.documents.length} sources · ${styleLabel()}` : '';
}

function renderCaptureCard(): void {
  const type = $('capType');
  const title = $('capTitle');
  const meta = $('capMeta');
  const fileBtn = $<HTMLButtonElement>('fileBtn');

  if (!state.preview && state.previewBlocked) {
    // The article IS open — Chrome just hasn't let us read the tab: the
    // activeTab grant is spent by navigation. Saying "no page metadata" here
    // sent users hunting for a problem the page doesn't have. Offer the
    // standing grant; the click below is the user gesture the request needs.
    type.textContent = 'No access to this tab yet';
    title.textContent = 'Let Context Notes read pages you open';
    meta.textContent =
      'Chrome grants one-time access only to the tab where you clicked the toolbar icon. ' +
      'Allow reading pages to preview and file any tab — revocable per site in Site access.';
    fileBtn.disabled = false;
    fileBtn.textContent = 'Allow reading pages';
    fileBtn.dataset['mode'] = 'grant';
    $<HTMLButtonElement>('copyInText').disabled = true;
    $<HTMLButtonElement>('copyBiblio').disabled = true;
    return;
  }
  fileBtn.dataset['mode'] = 'file';

  if (!state.preview) {
    type.textContent = 'No page metadata';
    title.textContent = 'Open an article to capture it';
    meta.textContent = '';
    fileBtn.disabled = true;
    fileBtn.textContent = 'File into project';
    return;
  }

  if (state.previewIsSearchPage) {
    // Filing a results page would store the query string as a "source" —
    // the Google Scholar trap. Say so instead of offering a broken capture.
    type.textContent = 'Search results page';
    title.textContent = 'Open an article from these results to file it';
    meta.textContent = 'Search pages carry no article metadata.';
    fileBtn.disabled = true;
    fileBtn.textContent = 'Nothing to file here';
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

  // Enabled whenever this page is IN the project — not only when it was filed
  // in this session. Re-opening the panel on a source captured last week left
  // both buttons greyed out, which reads as "there is no way to copy a
  // citation here".
  const citable = state.filedReferenceId !== null || state.pageDocumentId !== null;
  $<HTMLButtonElement>('copyInText').disabled = !citable;
  $<HTMLButtonElement>('copyBiblio').disabled = !citable;
}

// --------------------------------------------------------------------------
// On this page — web annotations for the previewed URL
// --------------------------------------------------------------------------

function isCapturablePreview(): boolean {
  return state.preview !== null && /^https?:/i.test(state.preview.url);
}

function annotationQuote(a: Annotation): string {
  if (a.anchor.kind !== 'web') return '';
  const selector = a.anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'textQuote');
  return selector?.exact ?? '';
}

/**
 * Scroll the page these notes belong to, to one of them.
 *
 * Addressed by URL, not "whatever tab is active": the panel outlives tab
 * switches, so a blind jump used to land on whichever page the user happened
 * to be looking at — or nowhere at all.
 */
function jumpToAnnotation(id: Id): void {
  const url = state.preview?.url;
  chrome.runtime
    .sendMessage(
      url ? { control: 'annotator/openAndJump', url, id } : { control: 'annotator/jump', id },
    )
    .catch(() => {});
}

/** `jumpable` is false for a note in the "couldn't place" list: its anchor did
 *  not resolve on this page, so there is no overlay to scroll to — offering
 *  "Jump to" would be a silent no-op. */
function makeOnPageCard(a: Annotation, jumpable: boolean): HTMLElement {
  const card = document.createElement('article');
  card.className = 'onpage-note';
  card.dataset.id = a.id;
  card.dataset.odId = `onpage-note-${a.id}`;

  // The card itself jumps to the passage — the "Jump to" button stays for
  // discoverability, but a click anywhere sensible on the card does it too.
  if (jumpable) {
    card.classList.add('onpage-note--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Scroll to this highlight on the page');
    const jump = (e: Event): void => {
      const el = e.target as HTMLElement;
      // The note editor, the status select and the buttons own their clicks.
      if (el.closest('button, select, textarea')) return;
      jumpToAnnotation(a.id);
    };
    card.addEventListener('click', jump);
    card.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('button, select, textarea')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        jump(e);
      }
    });
  }

  const quote = annotationQuote(a);
  if (quote) {
    const q = document.createElement('div');
    q.className = 'onpage-note__quote';
    const entry = paletteEntry(a.color);
    if (entry) {
      const dot = document.createElement('span');
      dot.className = 'cdot';
      dot.style.background = entry.swatch;
      dot.title = entry.label; // the legend, on hover
      q.append(dot);
    }
    q.append(document.createTextNode(quote)); // never innerHTML — page content.
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

  const sectionPick = document.createElement('select');
  sectionPick.className = 'onpage-note__section';
  sectionPick.setAttribute('aria-label', 'Section of your draft');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No section';
  sectionPick.append(none);
  const outline = currentOutline();
  for (const s of outline) {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.title; // user text, from an option's textContent — never innerHTML.
    sectionPick.append(option);
  }
  // A stored id that names no section in `outline` (reachable via the delete
  // path's partial-failure branch: the section removed from
  // `project.outline`, but this annotation's own `.section` not yet cleared
  // before a later write in that same loop failed) has no matching
  // `<option>`. Assigning it anyway would leave `selectedIndex` at -1 — an
  // empty-looking picker — instead of falling back to the "No section"
  // option that is already there for exactly this case.
  sectionPick.value = a.section && outline.some((s) => s.id === a.section) ? a.section : '';
  // `change`, matching the status select above: it fires once the browser has
  // already committed the pick and closed its native dropdown, so the async
  // save (and the repaint it can trigger via `renderOnPageCard`) never runs
  // while that dropdown is still open.
  sectionPick.addEventListener('change', () => {
    void updatePageAnnotationSection(a.id, sectionPick.value || undefined);
  });
  foot.append(sectionPick);

  if (jumpable) {
    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'btn onpage-note__jump';
    jumpBtn.textContent = 'Jump to';
    jumpBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // the card's own click would otherwise fire too
      jumpToAnnotation(a.id);
    });
    foot.append(jumpBtn);
  }

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

let lastOnPageSignature: string | null = null;

function renderOnPageCard(): void {
  const section = $('onPageCard');
  const capturable = isCapturablePreview();
  section.hidden = !capturable;
  if (!capturable) {
    lastOnPageSignature = null;
    return;
  }

  const signature = onPageSignature(state.pageAnnotations, palette, state.resolvedIds);
  if (signature === lastOnPageSignature && $('onPageList').childElementCount > 0) return;
  lastOnPageSignature = signature;

  const list = $('onPageList');
  const annotations = state.pageAnnotations;
  const focused = captureFocusedNoteEdit();

  if (annotations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'onpage-empty';
    // Only promise "select text" when it is literally true (annotator
    // auto-activates under the standing grant); otherwise say the real
    // first step, or selecting does nothing and reads as broken.
    empty.textContent = state.standingAccess
      ? 'No notes on this page yet — select text on the page, then choose Highlight or Note.'
      : 'No notes yet — press “Annotate this page”, allow the site once, then select text.';
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

  const nodes: HTMLElement[] = placed.map((a) => makeOnPageCard(a, true));
  if (lost.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'onpage-lost__heading';
    heading.textContent = "Couldn't place on this page";
    nodes.push(heading, ...lost.map((a) => makeOnPageCard(a, false)));
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
  // The textarea already shows this; keep the signature in step so no later
  // render rebuilds the list for a change the reader is looking at.
  lastOnPageSignature = onPageSignature(state.pageAnnotations, palette, state.resolvedIds);
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

/** `section` is `Id | undefined`, never `''` — the picker's "No section"
 *  option maps to `undefined` before this is called. `exactOptionalPropertyTypes`
 *  means clearing it has to delete the key, not assign it away. */
async function updatePageAnnotationSection(id: Id, section: Id | undefined): Promise<void> {
  const idx = state.pageAnnotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const updated: Annotation = { ...state.pageAnnotations[idx]!, updatedAt: nowIso() };
  if (section === undefined) delete updated.section;
  else updated.section = section;
  state.pageAnnotations[idx] = updated;
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t change section', true);
    return;
  }
  const title = currentOutline().find((s) => s.id === section)?.title;
  toast(title ? `Section · ${title}` : 'Removed from the outline');
  // Only assigning (not clearing) a section can create the states either
  // nudge cares about — clearing one can only ever add to Unplaced.
  if (section !== undefined) void nudgeOutlineProgress(id);
  // The checklist's Outline step is project-wide data, not part of
  // `pageAnnotations` above — without this, assigning a section from THIS
  // panel would only tick the checklist off after a later `data/changed`
  // broadcast (which this client's own writes are filtered out of). Outside
  // the try above deliberately: a throw here follows a SUCCESSFUL put, and
  // must not surface as "Couldn't change section".
  await loadAnnotationCount();
  renderGettingStarted();
}

/**
 * The two Outline-progress nudges, fired from the one place in this panel a
 * section is actually assigned (the dashboard's Outline route has its own
 * per-row picker, but no nudge mechanism of its own to hook into). Both
 * conditions are project-wide — "the very first passage placed" and "the
 * last unplaced one cleared" — so this re-fetches the whole project's
 * annotations rather than trusting `state.pageAnnotations`, which only ever
 * covers the page currently open.
 */
async function nudgeOutlineProgress(justSectionedId: Id): Promise<void> {
  if (!state.activeProjectId) return;
  try {
    const all = await sendRequest({
      type: 'annotations/listByProject',
      projectId: state.activeProjectId,
    });
    // Mirrors `groupPassages`'s `unsectioned` predicate: a `section` naming a
    // since-deleted section does not count as placed. Safe to treat as
    // "placed = not unplaced" here specifically, because this function only
    // ever runs right after a real section was assigned, which rules out the
    // colour-grouping fallback (`groupPassages` only falls back to colour
    // grouping while NO annotation carries a section at all).
    const sectionIds = new Set(currentOutline().map((s) => s.id));
    const placed = all.filter((a) => a.section !== undefined && sectionIds.has(a.section));
    // Fires only on the placement that took the project from zero placed
    // passages to one — not on the first placement action of THIS session,
    // which could be a project's second, third, or later one.
    if (placed.length === 1 && placed[0]?.id === justSectionedId) {
      nudgeNext('first-section', 'Your draft is taking shape — see it in Outline');
    }
    // The "at least one placed" half of the condition is `placed.length > 0`,
    // not merely `all.length > 0`: a project can have annotations that are
    // all still Unplaced, and this must not fire for that case.
    if (placed.length > 0 && placed.length === all.length) {
      nudgeNext('outline-complete', 'Ready to export — copy the draft into your editor');
    }
  } catch {
    // Nudges are decoration — a failed re-fetch must not surface as an error.
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
  const card = document.querySelector<HTMLElement>(`.onpage-note[data-id="${CSS.escape(id)}"]`);
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

  // Copying used to be the whole row's invisible click action — an unlabeled
  // clipboard write where a user expects "open". Now the row opens the
  // source and the copy is a named button.
  const citeBtn = document.createElement('button');
  citeBtn.className = 'status-btn doc__cite';
  citeBtn.textContent = 'Cite';
  citeBtn.title = 'Copy in-text citation';
  citeBtn.dataset.odId = `cite-${doc.id}`;
  citeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void copyDocCitation(doc);
  });
  foot.append(citeBtn);

  if (doc.section) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = doc.section;
    foot.append(chip);
  }

  const openDoc = (): void => {
    if (/^https?:/i.test(doc.url)) {
      chrome.tabs.create({ url: doc.url }).catch(() => {});
    } else {
      void copyDocCitation(doc); // a PDF upload has no web address to open
    }
  };
  row.setAttribute('aria-label', `Open ${m.title ?? doc.url}`);
  row.append(title, metaEl, foot);
  row.addEventListener('click', openDoc);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDoc();
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

/**
 * Journey nudges: when an action completes, say what the natural NEXT action
 * is, in the moment it becomes natural — file → annotate → set a status →
 * cite → share. Each nudge fires at most once per panel session, never after
 * the user dismissed the tutorial, and waits out the action's own toast so it
 * doesn't overwrite the confirmation the user is reading.
 */
const firedNudges = new Set<string>();
function nudgeNext(id: string, message: string): void {
  if (state.gettingStartedDismissed || firedNudges.has(id)) return;
  firedNudges.add(id);
  setTimeout(() => toast(message), 2700);
}

/**
 * The built-in tutorial: six workflow steps checked off from real project
 * data, shown until every step is done or the user closes it. The first
 * undone step carries a one-line hint — teaching one move at a time instead
 * of a wall of instructions.
 */
function renderGettingStarted(): void {
  const card = $('gsCard');
  const steps = gettingStartedSteps({
    hasCapturablePage: isCapturablePreview() && !state.previewIsSearchPage,
    documentCount: state.documents.length,
    annotationCount: state.annotationCount,
    movedBeyondToRead: state.documents.some((d) => d.status !== 'toRead'),
    hasSectionedAnnotation: state.hasSectionedAnnotation,
    copiedCitation: state.copiedCitation,
  });
  const hide = state.gettingStartedDismissed || gettingStartedComplete(steps);
  card.hidden = hide;
  if (hide) return;

  const list = $('gsList');
  const firstUndone = steps.find((s) => !s.done)?.id;
  list.replaceChildren(
    ...steps.flatMap((step) => {
      const li = document.createElement('li');
      li.className = `gs-step${step.done ? ' done' : ''}${step.id === firstUndone ? ' current' : ''}`;
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = step.done ? '✓' : '○';
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = step.label;
      li.append(tick, lbl);
      if (step.id !== firstUndone) return [li];
      const hint = document.createElement('li');
      hint.className = 'gs-hint';
      hint.textContent = step.hint;
      return [li, hint];
    }),
  );
}

/** True while the caret is in a note's editor. A repaint would replace that
 *  textarea mid-keystroke: characters typed in the gap land on a detached
 *  node, and the value can revert to the last SAVED text. */
function isEditingNote(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement && active.classList.contains('onpage-note__ta');
}

function render(): void {
  // A full repaint reflows the whole panel; without this the list jumped
  // under the reader's hands whenever anything was saved.
  const body = document.getElementById('scrollBody');
  const scrollTop = body?.scrollTop ?? 0;
  renderHeader();
  renderGettingStarted();
  renderCaptureCard();
  renderOnPageCard();
  renderSegmented();
  renderList();
  renderProgress();
  if (body && body.scrollTop !== scrollTop) body.scrollTop = scrollTop;
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

async function fileCurrentPage(): Promise<void> {
  if (!state.activeProjectId) return;
  if (state.previewIsSearchPage) {
    // Belt to the button's braces: the disabled state could be stale if the
    // tab changed between render and click.
    toast('This is a search page — open an article to file it', true);
    return;
  }
  try {
    const result = await captureActiveTab(state.activeProjectId);
    state.filedReferenceId = result.reference.id;
    state.filedUrl = state.preview?.url ?? null;
    await loadDocuments();
    render();
    toast(result.deduped ? 'Already filed — reused existing source' : 'Filed into project');
    if (state.annotationCount === 0) {
      nudgeNext('after-file', 'Next: “Annotate this page”, then select a passage to highlight it');
    }
    // Page tags are patchy (missing years, no volume/pages, inconsistent
    // author forms); the registry record behind the same DOI is complete.
    // Best-effort: the capture already succeeded, so a failed lookup (offline,
    // stale DOI) costs nothing and says nothing.
    if (result.document.metadata.doi && !result.deduped) {
      try {
        // Same host access importByDoi asks for — without it this lookup
        // fails with a raw fetch error for anyone who has never used Import
        // by DOI. Declining costs nothing: the captured metadata stays, same
        // as any other failure on this best-effort path.
        if (await requestDoiAccess()) {
          const enriched = await sendRequest({
            type: 'documents/enrichFromDoi',
            documentId: result.document.id,
          });
          state.filedReferenceId = enriched.reference.id;
          await loadDocuments();
          render();
          toast('Metadata completed from the DOI registry');
        }
      } catch {
        // keep the captured metadata
      }
    }
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
    below < menu.offsetHeight + 12 ? `${box.top - menu.offsetHeight - 6}px` : `${box.bottom + 6}px`;
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
  await loadPalette();
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
    outline: defaultOutline(),
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
    if (status !== 'toRead' && !state.copiedCitation) {
      nudgeNext(
        'after-status',
        'When it’s analysed, “Cite” on the row copies its in-text citation',
      );
    }
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
    if (!state.copiedCitation) {
      // Every copy in this panel is a citation of some form — that is the
      // one checklist step no stored record can prove.
      state.copiedCitation = true;
      void markCitationCopied();
      renderGettingStarted();
      nudgeNext(
        'after-cite',
        '“Copy bibliography” compiles every source — and Dashboard → Team → Sync shares the project as one file',
      );
    }
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

/** The citation for the page on screen: the reference just filed if there is
 *  one, else the document this page already is in the project. */
async function citeCurrentPage(
  form: 'inText' | 'bibliography',
): Promise<{ inText: string; bibliography: string } | null> {
  if (state.filedReferenceId) {
    return sendRequest({
      type: 'citations/reference',
      referenceId: state.filedReferenceId,
      ...citeArgs(),
    });
  }
  if (state.pageDocumentId) {
    return sendRequest({
      type: 'citations/document',
      documentId: state.pageDocumentId,
      ...citeArgs(),
    });
  }
  void form;
  return null;
}

async function copyCaptureInText(): Promise<void> {
  try {
    const out = await citeCurrentPage('inText');
    if (out) await copyToClipboard(out.inText, 'In-text citation');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t build citation', true);
  }
}

async function copyCaptureBiblio(): Promise<void> {
  try {
    const out = await citeCurrentPage('bibliography');
    if (out) await copyToClipboard(out.bibliography, 'Bibliography entry');
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
  $('fileBtn').addEventListener('click', () => {
    if ($<HTMLButtonElement>('fileBtn').dataset['mode'] === 'grant') {
      void (async () => {
        const granted = await requestStandingPageAccess();
        if (granted) {
          state.standingAccess = true;
          toast('Pages you open can now be previewed and filed');
          await refreshPreview();
        } else {
          toast('Not granted — reopen the panel from the toolbar icon on the page you want', true);
        }
      })();
      return;
    }
    void fileCurrentPage();
  });
  $('copyInText').addEventListener('click', () => void copyCaptureInText());
  $('copyBiblio').addEventListener('click', () => void copyCaptureBiblio());
  $('bibBtn').addEventListener('click', () => void copyProjectBibliography());
  $('annotateBtn').addEventListener('click', () => {
    // The worker reports {ok:false} for pages Chrome refuses to script
    // (chrome://, the Web Store, PDF tabs, a missing grant). Throwing that
    // result away made the button a silent no-op — say why nothing happened.
    chrome.runtime
      .sendMessage({ control: 'annotator/activate' })
      .then((res: { ok?: boolean } | undefined) => {
        if (!res?.ok) toast('Chrome doesn’t allow annotating this page', true);
      })
      .catch(() => toast('Chrome doesn’t allow annotating this page', true));
  });
  $('switchBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    openProjectMenu($('switchBtn'));
  });
  // The dashboard was unreachable from the panel — the primary surface had
  // no route to the main workspace at all.
  $('dashBtn').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
  $('guideBtn').addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
  });
  $('gsDismiss').addEventListener('click', () => {
    state.gettingStartedDismissed = true;
    void dismissGettingStarted();
    renderGettingStarted();
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
  // Any surface (dashboard, PDF reader, another window) writing data makes
  // this list stale; the service worker broadcasts after every successful
  // mutation. Debounced: an import fires dozens of writes in a burst.
  let dataChangedTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshDeferred = false;
  const onDataChanged = (): void => {
    clearTimeout(dataChangedTimer);
    dataChangedTimer = setTimeout(() => {
      // Never repaint under a typing hand: re-read once the note is left.
      if (isEditingNote()) {
        refreshDeferred = true;
        return;
      }
      void (async () => {
        state.projects = await sendRequest({ type: 'projects/list' });
        await loadStyles();
        await loadPalette();
        await loadDocuments();
        await loadAnnotationCount();
        await loadPageAnnotations();
        render();
      })();
    }, 400);
  };

  // A refresh deferred because the reader was mid-sentence runs the moment
  // the caret leaves the note — never in the middle of a word.
  document.addEventListener(
    'focusout',
    () => {
      if (!refreshDeferred) return;
      refreshDeferred = false;
      setTimeout(() => {
        if (!isEditingNote()) onDataChanged();
      }, 0);
    },
    true,
  );

  chrome.runtime.onMessage.addListener(
    (message: {
      control?: string;
      id?: string;
      url?: string;
      sourceClient?: string;
      resolvedIds?: string[];
    }) => {
      if (message?.control === 'data/changed') {
        // Our own write coming back to us: the panel already shows it, and
        // re-reading here is what made typing a note rebuild the panel.
        if (message.sourceClient === CLIENT_ID) return;
        onDataChanged();
      } else if (message?.control === 'annotator/changed') {
        void (async () => {
          const hadNone = state.annotationCount === 0;
          await loadPageAnnotations();
          await loadAnnotationCount();
          renderOnPageCard();
          renderGettingStarted();
          if (hadNone && state.annotationCount > 0) {
            nudgeNext(
              'after-annotate',
              'Saved — when you start working through this source, move it to “In review” from its status chip',
            );
          }
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

  const onboarding = await getOnboardingState();
  state.gettingStartedDismissed = onboarding.dismissed;
  state.copiedCitation = onboarding.copiedCitation;
  state.standingAccess = await hasStandingPageAccess();

  // Store updates are silent — surface the pending one until the user
  // dismisses it (which also takes the NEW badge off the toolbar icon).
  const updated = await getUpdateNotice();
  if (updated) {
    $('whatsNewText').textContent = `Updated to v${updated} —`;
    $('whatsNew').hidden = false;
    $('whatsNewDismiss').addEventListener('click', () => {
      $('whatsNew').hidden = true;
      void dismissUpdateNotice();
    });
  }

  await ensureSeedProject();
  await restoreActiveProject();
  await loadStyles();
  await loadPalette();
  await loadDocuments();
  await loadAnnotationCount();
  render();
  await loadPreview();
  await loadPageAnnotations();
  renderCaptureCard();
  renderOnPageCard();
  renderGettingStarted();
}

document.addEventListener('DOMContentLoaded', () => void init());
