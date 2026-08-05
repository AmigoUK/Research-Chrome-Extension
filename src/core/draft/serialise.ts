/**
 * Two renderings of one `Draft`.
 *
 * The escaping rule is the whole point of this file: `quote` and `note` are
 * text captured from arbitrary web pages and MUST be escaped; `inTextFormatted`
 * and `bibliography` come from citeproc and MUST NOT be, or the italics a word
 * processor needs die on the way to the clipboard. The field names carry the
 * distinction so a mistake is visible at the point of use.
 */
import type { Draft, DraftEntry } from '../usecases/draft';
import { escapeHtml } from '../text/escape';

const NO_REFERENCE = 'no bibliographic data — complete it in Documents';
const NO_TEXT = 'region — no text captured';
/** A direct quote needs a page, and a PDF's file page is not the printed page.
 *  A visible gap is better than a confident wrong citation in submitted work. */
const PAGE_PLACEHOLDER = '[page?]';

function citationHtml(entry: DraftEntry): string {
  if (entry.missingReference) return ` <em>&lt;${escapeHtml(NO_REFERENCE)}&gt;</em>`;
  if (!entry.inTextFormatted) return '';
  const page = entry.quote ? ` ${escapeHtml(PAGE_PLACEHOLDER)}` : '';
  const where = entry.locator ? ` <em>&lt;${escapeHtml(entry.locator)}&gt;</em>` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

function entryHtml(entry: DraftEntry): string {
  const body = entry.quote
    ? `<blockquote><p>${escapeHtml(entry.quote)}${citationHtml(entry)}</p></blockquote>`
    : `<p><em>&lt;${escapeHtml(NO_TEXT)}${entry.locator ? `, ${escapeHtml(entry.locator)}` : ''}&gt;</em>${citationHtml(entry)}</p>`;
  const note = entry.note ? `<p><em>My note:</em> ${escapeHtml(entry.note)}</p>` : '';
  return body + note;
}

export function draftToHtml(draft: Draft): string {
  const head = [
    `<h1>${escapeHtml(draft.projectName)}</h1>`,
    draft.researchQuestion ? `<p><strong>${escapeHtml(draft.researchQuestion)}</strong></p>` : '',
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

function citationText(entry: DraftEntry): string {
  if (entry.missingReference) return ` <${NO_REFERENCE}>`;
  if (!entry.inTextFormatted) return '';
  const page = entry.quote ? ` ${PAGE_PLACEHOLDER}` : '';
  const where = entry.locator ? ` <${entry.locator}>` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

function entryMarkdown(entry: DraftEntry): string {
  const body = entry.quote
    ? `> ${entry.quote}${citationText(entry)}`
    : `<${NO_TEXT}${entry.locator ? `, ${entry.locator}` : ''}>${citationText(entry)}`;
  const note = entry.note ? `\n\n*My note:* ${entry.note}` : '';
  return `${body}${note}\n`;
}

export function draftToMarkdown(draft: Draft): string {
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
