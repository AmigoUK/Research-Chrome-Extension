import type { Annotation, HighlightColor, Id } from '../core/model/types';

/**
 * A fingerprint of everything the on-page note list actually shows.
 *
 * `renderOnPageCard` rebuilds the list only when this changes. That guard is
 * what stopped a single note autosave from causing 13 DOM rebuilds (v1.7.4) —
 * rebuilds that replaced the textarea under the reader's hands and dropped
 * keystrokes. The cost of the guard is the opposite failure: a field the card
 * displays but the signature ignores looks like a control that does nothing.
 * Every displayed field belongs here, and `on-page-signature.test.ts` enforces it.
 */
export function onPageSignature(
  annotations: Annotation[],
  palette: HighlightColor[],
  resolvedIds: Set<Id>,
): string {
  return JSON.stringify([
    annotations.map((a) => [a.id, a.content, a.status, a.color, a.section]),
    [...resolvedIds].sort(),
    palette.map((c) => [c.id, c.swatch, c.label]),
  ]);
}
