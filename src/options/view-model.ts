/**
 * Dashboard view-model: pure, DOM-free helpers for the options-page dashboard.
 * Reuses the side-panel status vocabulary (single source of truth) and adds the
 * routing + presentation-neutral data the renderer consumes. No DOM or `chrome.*`
 * here, so it is unit-testable.
 */
import type { DocumentStatus } from '../core/model/workflow';
import { STATUS_META, statusLabel } from '../sidepanel/view-model';

export { STATUS_META, statusLabel };

/** Top-level dashboard routes, in nav order. Team + full style editor are out of
 * scope for Phase 2 (deferred to later phases). */
export const ROUTES = ['overview', 'documents', 'annotations', 'references', 'styles'] as const;
export type Route = (typeof ROUTES)[number];

export function isRoute(value: string): value is Route {
  return (ROUTES as readonly string[]).includes(value);
}

/** Topbar [title, subtitle] per route. */
export const ROUTE_TITLES: Record<Route, readonly [string, string]> = {
  overview: ['Overview', 'Project workspace'],
  documents: ['Documents', 'Sources in this project'],
  annotations: ['Annotations', 'Notes across the project'],
  references: ['References', 'Bibliographic records'],
  styles: ['Citation styles', 'Style profiles & rules'],
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

/** Project-switcher source-count label, e.g. "5 src". */
export function sourceCountLabel(count: number): string {
  return `${count} src`;
}

/** Short project-name token for buttons like "File into <token>". */
export function projectShortName(name: string): string {
  return name.split(/[ —&]/)[0] || name;
}
