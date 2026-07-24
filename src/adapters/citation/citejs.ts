/**
 * citeproc-js citation formatter, via the citation-js wrapper.
 *
 * citation-js bundles the engine and the en-US locale. The base CSL styles are
 * vendored under `src/assets/csl` and registered on first use, which also lets
 * us register rule-compiled *custom* styles at runtime (Phase 4).
 */
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import apa from '../../assets/csl/apa.csl?raw';
import harvard1 from '../../assets/csl/harvard1.csl?raw';
import vancouver from '../../assets/csl/vancouver.csl?raw';
import chicagoAuthorDate from '../../assets/csl/chicago-author-date.csl?raw';
import chicagoNotes from '../../assets/csl/chicago-notes-bibliography.csl?raw';
import mla from '../../assets/csl/modern-language-association.csl?raw';
import type { CitationFormatter, CitationKind, CslItem } from '../../core/ports/citation';
import type { CitationStyle } from '../../core/model/types';
import { templateFor } from '../../core/citation/styles';
import { compileCsl, applyRulesToItem, applyDoiFormat } from '../../core/citation/compile';

/** Base CSL XML keyed by citation-js template name. */
export const BASE_CSL: Record<string, string> = {
  apa,
  harvard1,
  vancouver,
  'chicago-author-date': chicagoAuthorDate,
  'chicago-notes-bibliography': chicagoNotes,
  'modern-language-association': mla,
};

function cslConfig(): {
  templates: { add(name: string, csl: string): void; get?(name: string): unknown };
} {
  return plugins.config.get('@csl') as {
    templates: { add(name: string, csl: string): void; get?(name: string): unknown };
  };
}

let stylesRegistered = false;
function ensureStyles(): void {
  if (stylesRegistered) return;
  const config = cslConfig();
  config.templates.add('chicago-author-date', chicagoAuthorDate);
  config.templates.add('chicago-notes-bibliography', chicagoNotes);
  config.templates.add('modern-language-association', mla);
  stylesRegistered = true;
}

/** Small deterministic hash so a (style, rules) pair maps to a stable template name. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export class CiteJsFormatter implements CitationFormatter {
  private readonly registered = new Set<string>();

  bibliography(items: CslItem[], template: string): string {
    ensureStyles();
    return new Cite(items)
      .format('bibliography', { format: 'text', template, lang: 'en-US' })
      .trim();
  }

  inText(items: CslItem[], template: string): string {
    ensureStyles();
    return new Cite(items).format('citation', { format: 'text', template, lang: 'en-US' }).trim();
  }

  compileStyle(style: CitationStyle): string {
    const baseCsl = BASE_CSL[templateFor(style.baseStyleId)];
    return baseCsl ? compileCsl(baseCsl, style.userRules) : '';
  }

  formatWithStyle(items: CslItem[], style: CitationStyle, kind: CitationKind): string {
    ensureStyles();
    const baseTemplate = templateFor(style.baseStyleId);
    const compiled = this.compileStyle(style);
    const rules = style.userRules;
    let template = baseTemplate;

    if (compiled) {
      const name = `custom:${hash(`${style.baseStyleId}:${JSON.stringify(rules)}`)}`;
      if (!this.registered.has(name)) {
        cslConfig().templates.add(name, compiled);
        this.registered.add(name);
      }
      template = name;
    }

    const processed = items.map((item) => applyRulesToItem(item, rules));
    const type = kind === 'bibliography' ? 'bibliography' : 'citation';
    const text = new Cite(processed)
      .format(type, { format: 'text', template, lang: 'en-US' })
      .trim();
    return applyDoiFormat(text, rules);
  }
}
