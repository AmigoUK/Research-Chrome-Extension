/**
 * citeproc-js citation formatter, via the citation-js wrapper.
 *
 * citation-js bundles the engine, the en-US locale, and the apa/harvard1/
 * vancouver templates. Chicago and MLA CSL styles are vendored under
 * `src/assets/csl` and registered on first use.
 */
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import chicagoAuthorDate from '../../assets/csl/chicago-author-date.csl?raw';
import mla from '../../assets/csl/modern-language-association.csl?raw';
import type { CitationFormatter, CslItem } from '../../core/ports/citation';

let stylesRegistered = false;

function ensureStyles(): void {
  if (stylesRegistered) return;
  const config = plugins.config.get('@csl') as {
    templates: { add(name: string, csl: string): void };
  };
  config.templates.add('chicago-author-date', chicagoAuthorDate);
  config.templates.add('modern-language-association', mla);
  stylesRegistered = true;
}

export class CiteJsFormatter implements CitationFormatter {
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
}
