import { describe, it, expect } from 'vitest';
import { highlightJson } from './csl-code';

describe('highlightJson', () => {
  it('marks keys, strings, booleans and numbers with their own classes', () => {
    const html = highlightJson({ title: 'APA 7th', 'include-doi': true, 'et-al-min': 4 });
    expect(html).toContain('<span class="k">"title"</span>');
    expect(html).toContain('<span class="s">"APA 7th"</span>');
    expect(html).toContain('<span class="b">true</span>');
    expect(html).toContain('<span class="b">4</span>');
  });

  it('nests objects with indentation and braces', () => {
    const html = highlightJson({ info: { title: 'X' } });
    expect(html).toContain(
      '<span class="k">"info"</span><span class="p">:</span> <span class="p">{</span>',
    );
    expect(html).toContain('    <span class="k">"title"</span>');
  });

  it('escapes markup in keys and values', () => {
    const html = highlightJson({ '<k>': '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;k&gt;');
  });
});
