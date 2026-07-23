/**
 * Base citation styles shipped in Phase 1, mapped to citation-js template
 * names. Additional styles (and user-rule overrides) come with the Phase 4
 * style editor.
 */
export const BASE_STYLE_TEMPLATES = {
  apa: 'apa',
  harvard: 'harvard1',
  chicago: 'chicago-author-date',
  mla: 'modern-language-association',
  vancouver: 'vancouver',
} as const;

export type BaseStyleId = keyof typeof BASE_STYLE_TEMPLATES;

export function templateFor(baseStyleId: string): string {
  return (BASE_STYLE_TEMPLATES as Record<string, string>)[baseStyleId] ?? 'apa';
}
