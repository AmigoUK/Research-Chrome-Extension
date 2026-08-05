/** Clipboard and file delivery for a composed draft. Kept out of `main.ts`
 *  because the filename rule is worth testing on its own. */
import type { Draft } from '../core/usecases/draft';
import { draftToHtml } from '../core/draft/serialise';

export function draftFilename(projectName: string, today: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `draft-${slug}-${today}.md` : `draft-${today}.md`;
}

/**
 * The clipboard's plain-text sibling, derived from the rendered HTML rather
 * than `draftToMarkdown`. `copyDraft` is always handed an `'html'`-flavour
 * draft (that is what the "Copy draft" button composes), and
 * `draftToMarkdown` requires `'text'` — calling it here would throw
 * `DraftFlavourMismatchError`, and composing a second, `'text'`-flavour
 * draft just to feed it would be the "compose once, render both" mistake
 * that guard exists to catch one level up (see `serialise.ts`).
 *
 * Regex, not `innerHTML` into a scratch element: `draftToHtml`'s output uses
 * exactly one escaper (`escapeHtml`, four entities) and a small, closed set
 * of tags, so reversing both here is exact — and it never hands parsed
 * markup back to the DOM at all, so there is nothing to sanitize.
 */
function plainTextFrom(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(h1|h2|p|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // `&amp;` must decode last: `escapeHtml` turns a literal "&lt;" into
  // "&amp;lt;". Decoding `&lt;`/`&gt;`/`&quot;` first leaves that alone (its
  // only `&` belongs to "&amp;", not to a "&lt;" substring), so the final
  // `&amp;` step correctly restores "&lt;". Decoding `&amp;` first would
  // produce "&lt;" one step early, which the *later* `&lt;` replace would
  // then wrongly decode a second time, into "<".
  const decoded = withBreaks
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  return decoded.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Copy the draft, keeping formatting where the platform allows it.
 *
 * Returns which flavour actually landed so the caller can tell the truth: a
 * silent drop to plain text would leave a student wondering why their
 * bibliography lost its italics.
 */
export async function copyDraft(draft: Draft): Promise<'rich' | 'plain'> {
  const html = draftToHtml(draft);
  const text = plainTextFrom(html);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return 'rich';
  } catch {
    await navigator.clipboard.writeText(text);
    return 'plain';
  }
}

/** Save via an object URL — no `downloads` permission, which would cost at
 *  store review for no gain here. */
export function downloadMarkdown(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can race the download in Chrome; one turn is enough.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
