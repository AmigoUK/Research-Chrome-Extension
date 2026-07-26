// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createWebAnchor, resolveWebAnchor, cssPath, webAnchorRoot } from './web';
import type { TextQuoteSelector } from '../model/types';

// Polyfill CSS.escape for jsdom
if (!globalThis.CSS?.escape) {
  const originalCSS = globalThis.CSS as any || {};
  originalCSS.escape = (value: string) =>
    value.replace(/([!"#$%&'()*+,./:;?@[\\\]^`{|}~])/g, '\\$1');
  globalThis.CSS = originalCSS;
}

function selectText(root: Element, needle: string): Range {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const idx = node.textContent?.indexOf(needle) ?? -1;
    if (idx >= 0) {
      const range = root.ownerDocument.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      return range;
    }
  }
  throw new Error(`text not found: ${needle}`);
}

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <article id="a">
      <p>The urban heat island re-radiates stored daytime heat overnight.</p>
      <p>Nocturnal cooling failure drives cardiovascular strain.</p>
    </article>`;
  root = document.getElementById('a') as HTMLElement;
});

describe('web anchoring', () => {
  it('creates a multi-strategy anchor and resolves it back to the same text', () => {
    const anchor = createWebAnchor(root, selectText(root, 'stored daytime heat'));
    expect(anchor.kind).toBe('web');
    expect(anchor.selectors.some((s) => s.type === 'textQuote')).toBe(true);
    expect(anchor.selectors.some((s) => s.type === 'textPosition')).toBe(true);

    const resolved = resolveWebAnchor(root, anchor);
    expect(resolved?.toString()).toBe('stored daytime heat');
  });

  it('re-anchors via text-quote after unrelated content shifts positions', () => {
    const anchor = createWebAnchor(root, selectText(root, 'cardiovascular strain'));

    // Simulate a page edit that shifts character offsets but keeps the quote.
    const intro = document.createElement('p');
    intro.textContent = 'A newly inserted introductory paragraph appears first.';
    root.insertBefore(intro, root.firstChild);

    const resolved = resolveWebAnchor(root, anchor);
    expect(resolved?.toString()).toBe('cardiovascular strain');
  });

  it('builds a css path down to an element', () => {
    const p = root.querySelector('p:nth-child(2)') as HTMLElement;
    expect(cssPath(root, p)).toBe('p:nth-child(2)');
  });
});

describe('the fallback chain survives a failing strategy', () => {
  it('falls through to text-position when the quote strategy throws', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>The energetic basis of the urban heat island.</p>';
    document.body.append(root);

    // A quote selector whose `exact` is not in the document, alongside a
    // position selector that is. Whether the library returns null or throws,
    // the next strategy must still get its turn.
    const anchor = {
      kind: 'web' as const,
      selectors: [
        { type: 'textQuote' as const, exact: 'nowhere to be found' },
        { type: 'textPosition' as const, start: 4, end: 13 },
      ],
    };

    const range = resolveWebAnchor(root, anchor);
    expect(range?.toString()).toBe('energetic');
    root.remove();
  });
});

describe('open Shadow DOM anchoring', () => {
  function shadowFixture(): { host: HTMLElement; root: ShadowRoot; text: Text } {
    document.body.innerHTML = '<section><div id="host"></div></section>';
    const host = document.getElementById('host') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>Alpha beta gamma delta epsilon.</p>';
    const text = root.querySelector('p')!.firstChild as Text;
    return { host, root, text };
  }

  it('anchors a selection inside an open shadow root, recording the host path', () => {
    const { host, root, text } = shadowFixture();
    const range = document.createRange();
    range.setStart(text, 6); // "beta gamma"
    range.setEnd(text, 16);
    const hostPath = cssPath(document.body, host);

    const anchor = createWebAnchor(root, range, hostPath);

    expect(anchor.shadowHost).toBe(hostPath);
    const quote = anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'textQuote');
    expect(quote?.exact).toBe('beta gamma');
  });

  it('round-trips: webAnchorRoot finds the root and resolveWebAnchor re-derives the range', () => {
    const { host, root, text } = shadowFixture();
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 16);
    const anchor = createWebAnchor(root, range, cssPath(document.body, host));

    const resolvedRoot = webAnchorRoot(document, anchor);
    expect(resolvedRoot).toBe(root);
    expect(resolveWebAnchor(resolvedRoot, anchor)?.toString()).toBe('beta gamma');
  });

  it('webAnchorRoot: no shadowHost → document.body', () => {
    expect(webAnchorRoot(document, { kind: 'web', selectors: [] })).toBe(document.body);
  });

  it('webAnchorRoot: an unresolvable shadowHost falls back to document.body', () => {
    document.body.innerHTML = '<p>plain</p>';
    expect(webAnchorRoot(document, { kind: 'web', selectors: [], shadowHost: '#gone' })).toBe(
      document.body,
    );
  });
});
