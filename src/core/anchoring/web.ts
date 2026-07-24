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

/** Build a structural CSS selector from `root` down to `element`. */
export function cssPath(root: Element, element: Element): string {
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
export function createWebAnchor(root: Element, range: Range): WebAnchor {
  const selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector> = [];

  const quote = textQuote.fromRange(root, range);
  selectors.push({
    type: 'textQuote',
    exact: quote.exact,
    ...(quote.prefix ? { prefix: quote.prefix } : {}),
    ...(quote.suffix ? { suffix: quote.suffix } : {}),
  });

  const position = textPosition.fromRange(root, range);
  selectors.push({ type: 'textPosition', start: position.start, end: position.end });

  const element = nearestElement(range.commonAncestorContainer);
  if (element) {
    const value = cssPath(root, element);
    if (value) selectors.push({ type: 'css', value });
  }

  return { kind: 'web', selectors };
}

/** Resolve a web anchor back to a Range, trying each strategy in order. */
export function resolveWebAnchor(root: Element, anchor: WebAnchor): Range | null {
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
