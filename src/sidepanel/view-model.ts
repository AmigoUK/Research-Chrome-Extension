/**
 * Side-panel view-model: pure functions that turn a list of documents into
 * the grouped, filtered reading-list shape the DOM renderer consumes. No DOM
 * or `chrome.*` here, so it is unit-testable.
 */
import type { Document } from '../core/model/types';
import { DOCUMENT_STATUSES, isReviewed, type DocumentStatus } from '../core/model/workflow';

export interface StatusMeta {
  id: DocumentStatus;
  label: string;
}

export const STATUS_META: StatusMeta[] = [
  { id: 'toRead', label: 'To read' },
  { id: 'inReview', label: 'In review' },
  { id: 'analysed', label: 'Analysed' },
  { id: 'usedInOutput', label: 'Used in output' },
];

export function statusLabel(status: DocumentStatus): string {
  return STATUS_META.find((s) => s.id === status)?.label ?? status;
}

export interface ListFilter {
  search: string;
  status: DocumentStatus | 'all';
}

function haystack(doc: Document): string {
  const m = doc.metadata;
  return [m.title, (m.authors ?? []).join(' '), m.journal, m.doi, doc.url]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function filterDocuments(docs: Document[], filter: ListFilter): Document[] {
  const q = filter.search.trim().toLowerCase();
  return docs.filter((d) => {
    if (filter.status !== 'all' && d.status !== filter.status) return false;
    if (q && !haystack(d).includes(q)) return false;
    return true;
  });
}

export interface StatusGroup {
  status: DocumentStatus;
  label: string;
  documents: Document[];
}

/** Group documents by status in pipeline order, dropping empty groups. */
export function groupByStatus(docs: Document[]): StatusGroup[] {
  return STATUS_META.map((s) => ({
    status: s.id,
    label: s.label,
    documents: docs.filter((d) => d.status === s.id),
  })).filter((g) => g.documents.length > 0);
}

export type StatusCounts = Record<DocumentStatus | 'all', number>;

export function statusCounts(docs: Document[]): StatusCounts {
  const counts = { all: docs.length } as StatusCounts;
  for (const s of DOCUMENT_STATUSES) counts[s] = 0;
  for (const d of docs) counts[d.status] += 1;
  return counts;
}

export interface Progress {
  total: number;
  reviewed: number;
  percent: number;
}

export function computeProgress(docs: Document[]): Progress {
  const total = docs.length;
  const reviewed = docs.filter((d) => isReviewed(d.status)).length;
  return { total, reviewed, percent: total === 0 ? 0 : Math.round((reviewed / total) * 100) };
}
