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
  /**
   * Drop a cached template so the next use re-reads it. Called when an imported
   * base style is replaced or deleted — without it the worker would serve the
   * old XML for the rest of its life.
   */
  forget?(template: string): void;
  /**
   * Format every citation of one draft against a single engine state.
   *
   * Necessary, not merely tidier: `.format('citation')` renders one cluster,
   * so per-source calls give every source `(1)` under a numeric style; and
   * citeproc disambiguates retroactively, so a cluster formatted without the
   * clusters that follow it can say "(Nowak 2016)" where the finished document
   * says "(Nowak 2016a)".
   *
   * `flavour: 'html'` keeps the italics a word processor needs.
   */
  formatRun(
    run: CitationRun,
    template: string,
    flavour: 'text' | 'html',
    style?: CitationStyle,
  ): Promise<CitationRunOutput>;
}

/** A whole document's citing, resolved in a single engine state. */
export interface CitationRun {
  items: CslItem[];
  /** Item ids in the order they are cited in the draft. Repeats allowed. */
  order: string[];
}

export interface CitationRunOutput {
  /** One citation per position in `order` — same length, same order. */
  inText: string[];
  /** The reference list, in the order the style dictates. */
  bibliography: string;
}
