/**
 * Document workflow statuses, in pipeline order.
 * Mirrors `Document.status` in data-model.md.
 *
 * Pure domain module — no `chrome.*` dependency, unit-testable in Node.
 */
export const DOCUMENT_STATUSES = ['toRead', 'inReview', 'analysed', 'usedInOutput'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** True once a document counts as reviewed (analysed or used in an output). */
export function isReviewed(status: DocumentStatus): boolean {
  return status === 'analysed' || status === 'usedInOutput';
}

/** The next status in the pipeline, or the same status if already at the end. */
export function nextStatus(status: DocumentStatus): DocumentStatus {
  const i = DOCUMENT_STATUSES.indexOf(status);
  return DOCUMENT_STATUSES[Math.min(i + 1, DOCUMENT_STATUSES.length - 1)] ?? status;
}
