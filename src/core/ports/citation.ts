/**
 * Citation formatter port. Implemented by the citeproc-js (citation-js)
 * adapter; the domain core depends only on this interface.
 */
import type { CitationStyle } from '../model/types';

/** A CSL-JSON item (as stored in `Reference.cslData`). */
export type CslItem = Record<string, unknown>;

export type CitationKind = 'bibliography' | 'inText';

export interface CitationFormatter {
  /** Formatted bibliography block (plain text) for the given items. */
  bibliography(items: CslItem[], template: string): string;
  /** Formatted in-text citation (plain text) for the given items. */
  inText(items: CslItem[], template: string): string;
  /**
   * Format items through a full `CitationStyle` — the base CSL compiled with the
   * style's user rules (author truncation, joiner, identifier inclusion). Falls
   * back to the plain base template when the base CSL is unavailable.
   */
  formatWithStyle(items: CslItem[], style: CitationStyle, kind: CitationKind): string;
}
