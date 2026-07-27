/**
 * Web-page anchoring: turn a DOM Range into a durable multi-strategy anchor
 * and resolve it back, following the W3C model (text-quote → text-position →
 * css). Text-quote/position use the Hypothesis libraries; the css selector is
 * a coarse structural fallback.
 *
 * DOM-dependent but storage- and `chrome.*`-free; tested under jsdom.
 */
import * as textQuote from 'dom-anchor-text-quote';
import * as textPosition from 'dom-anchor-text-position';
import type {
  WebAnchor,
  TextQuoteSelector,
  TextPositionSelector,
  CssSelector,
} from '../model/types';

// A text-quote's `exact` is the full selected text. A pathological selection
// (a whole article) would bloat every stored/exported anchor, so above this
// length we drop the quote and rely on the compact, precise textPosition
// offsets. Truncating `exact` instead would resolve to a shorter, wrong range
// (and text-quote is tried first), so omit rather than trim.
const MAX_QUOTE_EXACT = 10_000;

/** Build a structural CSS selector from `root` down to `element`. */
export function cssPath(root: ParentNode, element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== root) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const tag = node.tagName.toLowerCase();
    const index = Array.from(parent.children).indexOf(node) + 1;
    parts.unshift(`${tag}:nth-child(${index})`);
    node = parent;
  }
  return parts.join(' > ');
}

function nearestElement(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** Create a multi-strategy web anchor from a selection Range. */
export function createWebAnchor(root: ParentNode, range: Range, shadowHost?: string): WebAnchor {
  const selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector> = [];

  const quote = textQuote.fromRange(root, range);
  if (quote.exact.length <= MAX_QUOTE_EXACT) {
    selectors.push({
      type: 'textQuote',
      exact: quote.exact,
      ...(quote.prefix ? { prefix: quote.prefix } : {}),
      ...(quote.suffix ? { suffix: quote.suffix } : {}),
    });
  }

  const position = textPosition.fromRange(root, range);
  selectors.push({ type: 'textPosition', start: position.start, end: position.end });

  const element = nearestElement(range.commonAncestorContainer);
  if (element) {
    const value = cssPath(root, element);
    if (value) selectors.push({ type: 'css', value });
  }

  // Only attach shadowHost when present, to satisfy exactOptionalPropertyTypes.
  return shadowHost ? { kind: 'web', selectors, shadowHost } : { kind: 'web', selectors };
}

/** Resolve a web anchor back to a Range, trying each strategy in order. */
export function resolveWebAnchor(root: ParentNode, anchor: WebAnchor): Range | null {
  const quote = anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'textQuote');
  if (quote) {
    try {
      const range = textQuote.toRange(root, {
        exact: quote.exact,
        ...(quote.prefix ? { prefix: quote.prefix } : {}),
        ...(quote.suffix ? { suffix: quote.suffix } : {}),
      });
      if (range) return range;
    } catch {
      // The point of a strategy list is that a failing strategy hands over to
      // the next one. An exception here used to abandon the whole chain, so a
      // note that text-position could still have found was reported as lost.
    }
  }

  const position = anchor.selectors.find(
    (s): s is TextPositionSelector => s.type === 'textPosition',
  );
  if (position) {
    try {
      return textPosition.toRange(root, { start: position.start, end: position.end });
    } catch {
      // fall through to css
    }
  }

  const css = anchor.selectors.find((s): s is CssSelector => s.type === 'css');
  if (css) {
    const el = root.querySelector(css.value);
    if (el) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      return range;
    }
  }

  return null;
}

/** Turn a stored anchor's `shadowHost` back into the live root to anchor within.
 *  No host → document.body; a host that no longer resolves → document.body too,
 *  so a note is reported unplaced rather than mis-anchored against the wrong root. */
export function webAnchorRoot(doc: Document, anchor: WebAnchor): ParentNode {
  if (!anchor.shadowHost) return doc.body;
  try {
    return doc.querySelector(anchor.shadowHost)?.shadowRoot ?? doc.body;
  } catch {
    // A shadowHost from an imported (untrusted) snapshot may be a malformed
    // selector; a throw here would abort repaint for every note on the page.
    return doc.body;
  }
}
