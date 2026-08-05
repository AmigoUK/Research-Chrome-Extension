/**
 * The single answer to "what are this project's sections".
 *
 * Used by the Outline view, the side-panel picker and `composeDraft` alike.
 * Without one shared resolver a project mid-retirement of `Project.sections`
 * would show one set of sections on screen and compose the draft against
 * another — and since section order drives citation order, that silently
 * renumbers a Vancouver draft.
 */
import type { OutlineSection, Project } from '../model/types';

/** An essay's shape, not a research report's. The target reader is an
 *  undergraduate writing to a brief. */
export const DEFAULT_OUTLINE_TITLES = [
  'Introduction',
  'Background',
  'Evidence',
  'Counter-arguments',
  'Conclusion',
] as const;

/** Deterministic id from a title and its position: the same project must
 *  resolve to the same ids on every call, or assignments made against one
 *  render would dangle on the next. A random id here would look correct in
 *  a single render and lose every assignment on reload. */
function derivedId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `sec-${index}-${slug || 'section'}`;
}

function fromTitles(titles: readonly string[]): OutlineSection[] {
  return titles.map((title, i) => ({ id: derivedId(title, i), title }));
}

export function resolveOutline(project: Project): OutlineSection[] {
  if (project.outline && project.outline.length > 0) return project.outline;
  if (project.sections && project.sections.length > 0) return fromTitles(project.sections);
  return fromTitles(DEFAULT_OUTLINE_TITLES);
}

/** The outline a brand-new project starts with. One definition, called at all
 *  four new-project sites, so the defaults cannot drift apart again — they
 *  already had four copies of the old literal. */
export function defaultOutline(): OutlineSection[] {
  return fromTitles(DEFAULT_OUTLINE_TITLES);
}
