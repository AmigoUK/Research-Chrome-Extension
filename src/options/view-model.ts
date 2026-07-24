/**
 * Dashboard view-model: pure, DOM-free helpers for the options-page dashboard.
 * Reuses the side-panel status vocabulary (single source of truth) and adds the
 * routing + presentation-neutral data the renderer consumes. No DOM or `chrome.*`
 * here, so it is unit-testable.
 */
import { ACTIVITY_KINDS, type ActivityEvent, type ActivityKind } from '../core/model/types';
import type { DocumentStatus } from '../core/model/workflow';
import { ROLE_LABELS } from '../core/model/roles';
import { STATUS_META, statusLabel } from '../sidepanel/view-model';

export { STATUS_META, statusLabel };

/** Routes reachable from the sidebar nav, in nav order. */
export const NAV_ROUTES = [
  'overview',
  'documents',
  'annotations',
  'references',
  'styles',
  'team',
] as const;
export type NavRoute = (typeof NAV_ROUTES)[number];

/** Every route, including full-screen workspaces reached from inside a view.
 * `styleEditor` (Phase 4) is opened from the Citation styles view, not the nav. */
export const ROUTES = [...NAV_ROUTES, 'styleEditor'] as const;
export type Route = (typeof ROUTES)[number];

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

export function isNavRoute(value: string): value is NavRoute {
  return (NAV_ROUTES as readonly string[]).includes(value);
}

/** Full-screen workspaces hide the app shell (sidebar + credit footer). */
export function isFullScreenRoute(route: Route): boolean {
  return route === 'styleEditor';
}

/** Topbar [title, subtitle] per route. */
export const ROUTE_TITLES: Record<Route, readonly [string, string]> = {
  overview: ['Overview', 'Project workspace'],
  documents: ['Documents', 'Sources in this project'],
  annotations: ['Annotations', 'Notes across the project'],
  references: ['References', 'Bibliographic records'],
  styles: ['Citation styles', 'Style profiles & rules'],
  styleEditor: ['Style editor', 'Rules compile to CSL overrides'],
  team: ['Team', 'Collaboration & sync'],
};

/** CSS custom-property carrying each status colour in `dashboard.css`. */
export const STATUS_DOT: Record<DocumentStatus, string> = {
  toRead: 'var(--s-toread)',
  inReview: 'var(--s-inreview)',
  analysed: 'var(--s-analysed)',
  usedInOutput: 'var(--s-used)',
};

export function statusDot(status: DocumentStatus): string {
  return STATUS_DOT[status] ?? 'var(--muted)';
}

/* ---- Activity feed (Phase 5, M2) ---- */

/** HTML-escape a value for interpolation into a template string. */
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Local calendar day of an ISO timestamp, as `YYYY-MM-DD`. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function dayLabel(iso: string, nowIso: string): string {
  const key = dayKey(iso);
  const today = dayKey(nowIso);
  if (key === today) return 'Today';
  const yesterday = new Date(nowIso);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.toISOString())) return 'Yesterday';
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export interface ActivityDay {
  label: string;
  events: ActivityEvent[];
}

/**
 * Group events into the feed's day sections. Input is expected newest first
 * (that is how the repository reads them) and that order is preserved.
 */
export function groupActivityByDay(events: readonly ActivityEvent[], nowIso: string): ActivityDay[] {
  const days: ActivityDay[] = [];
  let currentKey: string | undefined;
  for (const event of events) {
    const key = dayKey(event.createdAt);
    if (key !== currentKey) {
      days.push({ label: dayLabel(event.createdAt, nowIso), events: [] });
      currentKey = key;
    }
    days[days.length - 1]?.events.push(event);
  }
  return days;
}

/**
 * Turn a raw `from`/`to` value into words. Events store domain values (status
 * ids, role ids) precisely so the labelling stays here.
 */
export function diffLabel(kind: ActivityKind, value: string): string {
  if (kind === 'status') return statusLabel(value as DocumentStatus);
  if (kind === 'member' && value in ROLE_LABELS) {
    return ROLE_LABELS[value as keyof typeof ROLE_LABELS];
  }
  return value;
}

/**
 * Escape a summary and emphasise the entity inside it. Escaping happens first,
 * so a document title containing markup can never inject HTML.
 */
export function highlightEntity(summary: string, entityLabel?: string): string {
  const safe = escapeHtml(summary);
  if (!entityLabel) return safe;
  const needle = escapeHtml(entityLabel);
  const at = safe.indexOf(needle);
  if (at < 0) return safe;
  return `${safe.slice(0, at)}<span class="ent">${needle}</span>${safe.slice(at + needle.length)}`;
}

/** The filter chips to show: `all` plus the kinds actually present in the feed. */
export function activityFilterKinds(events: readonly ActivityEvent[]): ActivityKind[] {
  const present = new Set(events.map((e) => e.kind));
  return ACTIVITY_KINDS.filter((k) => present.has(k));
}

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  source: 'Sources',
  status: 'Status',
  annotation: 'Annotations',
  comment: 'Comments',
  reference: 'References',
  member: 'Members',
  sync: 'Sync',
};

/** Project-switcher source-count label, e.g. "5 src". */
export function sourceCountLabel(count: number): string {
  return `${count} src`;
}

/** Short project-name token for buttons like "File into <token>". */
export function projectShortName(name: string): string {
  return name.split(/[ —&]/)[0] || name;
}
