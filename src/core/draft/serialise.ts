/**
 * Two renderings of one `Draft`, chosen by `draft.flavour`.
 *
 * `quote`, `note`, `locator`, section titles, the project name, the research
 * question and `dueDate` are text captured from arbitrary web pages — or from
 * an imported snapshot, someone else's file — and MUST be escaped in
 * `draftToHtml`.
 *
 * `inTextFormatted` and `bibliography` are citeproc's own output. In an
 * `'html'`-flavour draft that output is real markup (the italics a word
 * processor needs) and MUST NOT be escaped, or the markup prints as text. But
 * that is only true for an `'html'`-flavour draft: a `'text'`-flavour citeproc
 * run performs no escaping at all, so feeding a `'text'` draft's
 * `inTextFormatted`/`bibliography` (which may still contain `<`/`&` from a
 * reference's own title or author — reference data can arrive via an imported
 * snapshot too) to `draftToHtml`'s raw interpolation would reopen exactly the
 * injection this file exists to close. `draftToHtml` and `draftToMarkdown`
 * therefore each require the matching `flavour` and throw
 * `DraftFlavourMismatchError` rather than silently doing the wrong thing.
 */
import type { Draft, DraftEntry } from '../usecases/draft';
import { escapeHtml } from '../text/escape';

const NO_REFERENCE = 'no bibliographic data — complete it in Documents';
const NO_TEXT = 'region — no text captured';
/** A direct quote needs a page, and a PDF's file page is not the printed page.
 *  A visible gap is better than a confident wrong citation in submitted work. */
const PAGE_PLACEHOLDER = '[page?]';

/** Thrown when `draftToHtml`/`draftToMarkdown` receives a draft composed for
 *  the other flavour. Not cosmetic: a `'text'`-flavour citeproc run performs
 *  no escaping, so `draftToHtml` on one would let hostile reference data
 *  through unescaped; an `'html'`-flavour draft into `draftToMarkdown` is not
 *  an injection, but it does leave literal HTML tags and entities sitting in
 *  a plain-text export. Either way the fix is to compose the draft again with
 *  the right `flavour`, not to patch the output after the fact. */
export class DraftFlavourMismatchError extends Error {
  constructor(fn: 'draftToHtml' | 'draftToMarkdown', actual: Draft['flavour']) {
    const expected = fn === 'draftToHtml' ? 'html' : 'text';
    const why =
      fn === 'draftToHtml'
        ? "a 'text'-flavour citeproc run does not escape its output, so interpolating it as HTML would let hostile reference data through unescaped"
        : "an 'html'-flavour citeproc run emits real HTML tags and entities, which would show up as literal text in a plain-text/Markdown export";
    super(`${fn} requires a '${expected}'-flavour draft but received '${actual}': ${why}.`);
    this.name = 'DraftFlavourMismatchError';
  }
}

// The single place `entry.locator` is rendered for HTML — `entryHtml`'s
// no-quote branch used to interpolate it a second time (its own bracket, next
// to `NO_TEXT`), so a no-quote entry with a resolved citation and a locator
// showed "PDF p. 4" twice. Centralising it here, always (even when there is
// no citation to hang it off), is what keeps it to exactly one appearance
// regardless of which branch of `entryHtml` calls this.
function citationHtml(entry: DraftEntry): string {
  const where = entry.locator ? ` <em>&lt;${escapeHtml(entry.locator)}&gt;</em>` : '';
  if (entry.missingReference) return ` <em>&lt;${escapeHtml(NO_REFERENCE)}&gt;</em>${where}`;
  if (!entry.inTextFormatted) return where;
  const page = entry.quote ? ` ${escapeHtml(PAGE_PLACEHOLDER)}` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

/** Escapes each line, then joins with `<br>` rather than splitting into
 *  separate `<p>` elements: a captured selection's `\n` could be a paragraph
 *  break or a mid-paragraph line wrap and there is no way to tell which from
 *  here, so `<br>` reproduces the line structure faithfully without asserting
 *  a paragraph model the source may not have intended. Left as raw `\n` (the
 *  pre-fix behaviour), a word processor's clipboard renderer collapses it to
 *  whitespace and runs the lines together. */
function quoteHtml(quote: string): string {
  return quote
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');
}

function entryHtml(entry: DraftEntry): string {
  const body = entry.quote
    ? `<blockquote><p>${quoteHtml(entry.quote)}${citationHtml(entry)}</p></blockquote>`
    : `<p><em>&lt;${escapeHtml(NO_TEXT)}&gt;</em>${citationHtml(entry)}</p>`;
  const note = entry.note ? `<p><em>My note:</em> ${escapeHtml(entry.note)}</p>` : '';
  return body + note;
}

export function draftToHtml(draft: Draft): string {
  if (draft.flavour !== 'html') {
    throw new DraftFlavourMismatchError('draftToHtml', draft.flavour);
  }

  const head = [
    `<h1>${escapeHtml(draft.projectName)}</h1>`,
    draft.researchQuestion ? `<p><strong>${escapeHtml(draft.researchQuestion)}</strong></p>` : '',
    draft.dueDate ? `<p>Due: ${escapeHtml(draft.dueDate)}</p>` : '',
    draft.groupedByColour
      ? '<p><em>No outline yet — passages are grouped by highlight colour.</em></p>'
      : '',
  ].join('');

  const body = draft.sections
    .filter((s) => s.entries.length > 0)
    .map((s) => `<h2>${escapeHtml(s.title)}</h2>${s.entries.map(entryHtml).join('')}`)
    .join('');

  const unplaced =
    draft.unplaced.length > 0 ? `<h2>Unplaced</h2>${draft.unplaced.map(entryHtml).join('')}` : '';

  // citeproc's own markup, used as-is — escaping it would print the tags.
  const bibliography = draft.bibliography ? `<h2>References</h2>${draft.bibliography}` : '';

  return head + body + unplaced + bibliography;
}

// Mirrors citationHtml's reasoning: the single place `entry.locator` is
// rendered for Markdown, always, so a no-quote entry never shows it twice.
function citationText(entry: DraftEntry): string {
  const where = entry.locator ? ` <${entry.locator}>` : '';
  if (entry.missingReference) return ` <${NO_REFERENCE}>${where}`;
  if (!entry.inTextFormatted) return where;
  const page = entry.quote ? ` ${PAGE_PLACEHOLDER}` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

/** A blank line inside the quote would otherwise close the Markdown
 *  blockquote early, and a line starting `#` would become a heading —
 *  prefixing every line with `>` keeps a multi-paragraph selection (the
 *  normal case for a web or PDF passage, not an exotic one) inside one
 *  blockquote. A blank line gets a bare `>` rather than `> ` so the output
 *  carries no trailing whitespace. */
function quoteMarkdown(quote: string): string {
  return quote
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function entryMarkdown(entry: DraftEntry): string {
  const body = entry.quote
    ? `${quoteMarkdown(entry.quote)}${citationText(entry)}`
    : `<${NO_TEXT}>${citationText(entry)}`;
  const note = entry.note ? `\n\n*My note:* ${entry.note}` : '';
  return `${body}${note}\n`;
}

export function draftToMarkdown(draft: Draft): string {
  if (draft.flavour !== 'text') {
    throw new DraftFlavourMismatchError('draftToMarkdown', draft.flavour);
  }

  const parts: string[] = [`# ${draft.projectName}`];
  if (draft.researchQuestion) parts.push(`**${draft.researchQuestion}**`);
  if (draft.dueDate) parts.push(`Due: ${draft.dueDate}`);
  if (draft.groupedByColour) {
    parts.push('_No outline yet — passages are grouped by highlight colour._');
  }
  for (const section of draft.sections) {
    if (section.entries.length === 0) continue;
    parts.push(`## ${section.title}`, ...section.entries.map(entryMarkdown));
  }
  if (draft.unplaced.length > 0) {
    parts.push('## Unplaced', ...draft.unplaced.map(entryMarkdown));
  }
  if (draft.bibliography) parts.push('## References', draft.bibliography);
  return parts.join('\n\n');
}
