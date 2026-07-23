/**
 * Citation formatter port. Implemented by the citeproc-js (citation-js)
 * adapter; the domain core depends only on this interface.
 */

/** A CSL-JSON item (as stored in `Reference.cslData`). */
export type CslItem = Record<string, unknown>;

export interface CitationFormatter {
  /** Formatted bibliography block (plain text) for the given items. */
  bibliography(items: CslItem[], template: string): string;
  /** Formatted in-text citation (plain text) for the given items. */
  inText(items: CslItem[], template: string): string;
}
