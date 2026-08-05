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

// ---------------------------------------------------------------------------
// Getting-started checklist — the panel's built-in tutorial.
// ---------------------------------------------------------------------------

export interface GettingStartedInputs {
  /** The previewed tab is a filable article/web page (not a search page). */
  hasCapturablePage: boolean;
  documentCount: number;
  annotationCount: number;
  /** At least one source has moved past "To read". */
  movedBeyondToRead: boolean;
  /** At least one passage has been given a section of the outline — from
   *  either the dashboard's Outline route or the panel's own per-passage
   *  picker, both of which write the same `Annotation.section`. */
  hasSectionedAnnotation: boolean;
  /** The user has copied any citation or bibliography at least once. */
  copiedCitation: boolean;
}

export interface GettingStartedStep {
  id: 'open' | 'file' | 'annotate' | 'status' | 'outline' | 'cite';
  label: string;
  /** One short sentence shown for the first not-done step. */
  hint: string;
  done: boolean;
}

/**
 * The six moves that make the tool make sense, checked off from real data —
 * a tutorial that reads the project instead of trusting the user to say
 * "done". Order is the workflow order; the first undone step is "current".
 */
export function gettingStartedSteps(i: GettingStartedInputs): GettingStartedStep[] {
  return [
    {
      id: 'open',
      label: 'Open an article page',
      hint: 'Open the paper itself in this tab — search-results pages have nothing to file.',
      done: i.hasCapturablePage || i.documentCount > 0,
    },
    {
      id: 'file',
      label: 'File it into your project',
      hint: 'Press “File into project” above — a DOI fills in authors, year, volume and pages.',
      done: i.documentCount > 0,
    },
    {
      id: 'annotate',
      label: 'Highlight a passage',
      hint: 'Press “Annotate this page”, allow the site once, then select text → Highlight or Note.',
      done: i.annotationCount > 0,
    },
    {
      id: 'status',
      label: 'Move a source along the workflow',
      hint: 'Use the status chip on a reading-list row: To read → In review → Analysed → Used.',
      done: i.movedBeyondToRead,
    },
    {
      id: 'outline',
      label: 'Assign a passage to a section',
      hint: 'Open the dashboard’s Outline screen and give one highlight a section — Introduction, Evidence, whatever fits your draft.',
      done: i.hasSectionedAnnotation,
    },
    {
      id: 'cite',
      label: 'Copy a citation',
      hint: 'Press “Cite” on a row, or “Copy bibliography” below for the whole project.',
      done: i.copiedCitation,
    },
  ];
}

export function gettingStartedComplete(steps: GettingStartedStep[]): boolean {
  return steps.every((s) => s.done);
}
