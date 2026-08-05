/** Clipboard and file delivery for a composed draft. Kept out of `main.ts`
 *  because the filename rule is worth testing on its own. */
import type { Draft } from '../core/usecases/draft';
import { draftToHtml, draftToMarkdown } from '../core/draft/serialise';

export function draftFilename(projectName: string, today: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `draft-${slug}-${today}.md` : `draft-${today}.md`;
}

/**
 * Copy the draft, keeping formatting where the platform allows it.
 *
 * Takes two SEPARATELY COMPOSED drafts — an `'html'`-flavour one, rendered
 * by `draftToHtml` for `text/html`, and a `'text'`-flavour one, rendered by
 * `draftToMarkdown` for `text/plain` — never one derived from the other's
 * output. The module doc comment on `src/core/usecases/draft.ts` states why
 * the draft model is a structure rather than a string in the first place:
 * "a service worker has no `DOMParser` — deriving one [flavour] from the
 * other would mean hand-writing an HTML parser." Named fields, not two
 * positional `Draft`s, so a caller cannot swap them by argument order —
 * `draftToHtml`/`draftToMarkdown` would throw `DraftFlavourMismatchError` on
 * a swapped pair anyway, but naming the fields makes the correct pairing the
 * only one that is easy to write.
 *
 * Returns which flavour actually landed so the caller can tell the truth: a
 * silent drop to plain text would leave a student wondering why their
 * bibliography lost its italics.
 */
export async function copyDraft(drafts: { html: Draft; text: Draft }): Promise<'rich' | 'plain'> {
  const html = draftToHtml(drafts.html);
  const text = draftToMarkdown(drafts.text);
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
