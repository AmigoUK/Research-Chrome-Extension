/** Ambient types for the untyped Hypothesis anchoring libraries. */

declare module 'dom-anchor-text-quote' {
  export interface TextQuoteAnchor {
    exact: string;
    prefix?: string;
    suffix?: string;
  }
  export function fromRange(root: Node, range: Range): TextQuoteAnchor;
  export function toRange(
    root: Node,
    selector: TextQuoteAnchor,
    options?: { hint?: number },
  ): Range | null;
}

declare module 'dom-anchor-text-position' {
  export interface TextPositionAnchor {
    start: number;
    end: number;
  }
  export function fromRange(root: Node, range: Range): TextPositionAnchor;
  export function toRange(root: Node, selector: TextPositionAnchor): Range;
}
