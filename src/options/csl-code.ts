/**
 * Minimal JSON syntax highlighter for the style editor's "CSL override" tab.
 * Written by hand rather than pulled from a library: MV3's default CSP forbids
 * remote code, and a highlighter for a fixed, self-generated object is a dozen
 * lines. Pure string in / HTML string out, so it is unit-testable.
 *
 * Emitted classes match `dashboard.css`: `.k` key, `.s` string, `.b` boolean or
 * number, `.p` punctuation.
 */

function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

function scalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number')
    return `<span class="b">${esc(value)}</span>`;
  if (value === null) return `<span class="b">null</span>`;
  return `<span class="s">"${esc(value)}"</span>`;
}

function body(obj: Record<string, unknown>, indent: number): string {
  const pad = '  '.repeat(indent);
  return Object.entries(obj)
    .map(([key, value]) => {
      const label = `${pad}<span class="k">"${esc(key)}"</span><span class="p">:</span>`;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const inner = body(value as Record<string, unknown>, indent + 1);
        return `${label} <span class="p">{</span>\n${inner}\n${pad}<span class="p">}</span>`;
      }
      return `${label} ${scalar(value)}`;
    })
    .join('<span class="p">,</span>\n');
}

/** Highlighted HTML for a JSON object, wrapped in its outer braces. */
export function highlightJson(obj: Record<string, unknown>): string {
  return `<span class="p">{</span>\n${body(obj, 1)}\n<span class="p">}</span>`;
}
