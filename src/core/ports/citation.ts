/**
 * Citation formatter port. Implemented by the citeproc-js (citation-js)
 * adapter; the domain core depends only on this interface.
 */
import type { CitationStyle } from '../model/types';

/** A CSL-JSON item (as stored in `Reference.cslData`). */
export type CslItem = Record<string, unknown>;

export type CitationKind = 'bibliography' | 'inText';

/**
 * Every method is asynchronous because a base style is loaded on demand rather
 * than bundled: the CSL files are ~520 kB of XML that most sessions never touch.
 */
export interface CitationFormatter {
  /** Formatted bibliography block (plain text) for the given items. */
  bibliography(items: CslItem[], template: string): Promise<string>;
  /** Formatted in-text citation (plain text) for the given items. */
  inText(items: CslItem[], template: string): Promise<string>;
  /**
   * Format items through a full `CitationStyle` — the base CSL compiled with the
   * style's user rules (author truncation, joiner, identifier inclusion). Falls
   * back to the plain base template when the base CSL is unavailable.
   */
  formatWithStyle(items: CslItem[], style: CitationStyle, kind: CitationKind): Promise<string>;
  /**
   * The CSL XML a style compiles to — what the editor exports as a `.csl` file.
   * Empty when the base style has no vendored CSL.
   */
  compileStyle(style: CitationStyle): Promise<string>;
}
