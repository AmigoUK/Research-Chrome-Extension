/**
 * Base citation styles, mapped to citation-js template names. Each template is
 * a CSL file vendored under `src/assets/csl`; the Phase 4 style editor compiles
 * user rules on top of one of these.
 */
import type { CitationSystem } from '../model/types';
import { isCustomBaseStyleId } from './parse';

export const BASE_STYLE_TEMPLATES = {
  apa: 'apa',
  harvard: 'harvard1',
  chicago: 'chicago-author-date',
  'chicago-note': 'chicago-notes-bibliography',
  mla: 'modern-language-association',
  vancouver: 'vancouver',
} as const;

export type BaseStyleId = keyof typeof BASE_STYLE_TEMPLATES;

/**
 * The citation-js template name for a base style. An imported style is its own
 * template — its id doubles as the name the formatter registers it under.
 */
export function templateFor(baseStyleId: string): string {
  if (isCustomBaseStyleId(baseStyleId)) return baseStyleId;
  return (BASE_STYLE_TEMPLATES as Record<string, string>)[baseStyleId] ?? 'apa';
}

/**
 * Presentation metadata for the style picker. `system` is *declared* by the CSL
 * file itself (`<category citation-format="…"/>`) — the citation system is a
 * property of the base style, not something a user rule can override, so the
 * editor switches the base style when the user picks a different system.
 * `test/adapters/citation-style.test.ts` asserts this table against the
 * vendored CSL files so the two cannot drift apart.
 */
export interface BaseStyleInfo {
  id: BaseStyleId;
  label: string;
  system: CitationSystem;
}

export const BASE_STYLES: readonly BaseStyleInfo[] = [
  { id: 'apa', label: 'APA 7th edition', system: 'authorDate' },
  { id: 'harvard', label: 'Harvard — Cite Them Right', system: 'authorDate' },
  { id: 'chicago', label: 'Chicago (author–date)', system: 'authorDate' },
  { id: 'chicago-note', label: 'Chicago (notes & bibliography)', system: 'footnote' },
  { id: 'mla', label: 'MLA 9th edition', system: 'authorDate' },
  { id: 'vancouver', label: 'Vancouver', system: 'numeric' },
];

export function baseStyleInfo(baseStyleId: string): BaseStyleInfo | undefined {
  return BASE_STYLES.find((s) => s.id === baseStyleId);
}

/** The citation system a base style produces, defaulting to author–date. */
export function systemFor(baseStyleId: string): CitationSystem {
  return baseStyleInfo(baseStyleId)?.system ?? 'authorDate';
}

/** First base style producing `system` — used when the user switches system. */
export function baseStyleForSystem(system: CitationSystem): BaseStyleId {
  return BASE_STYLES.find((s) => s.system === system)?.id ?? 'apa';
}
