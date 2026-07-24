/**
 * citeproc-js citation formatter, via the citation-js wrapper.
 *
 * citation-js bundles the engine and the en-US locale. The base CSL styles are
 * vendored under `src/assets/csl` but **not** inlined here: they arrive through
 * an injected `CslLoader`, are registered on first use, and are cached for the
 * lifetime of the formatter. That keeps ~520 kB of XML out of the service-worker
 * bundle, and lets rule-compiled *custom* styles be registered the same way
 * (Phase 4).
 */
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import type { CitationFormatter, CitationKind, CslItem } from '../../core/ports/citation';
import type { CitationStyle } from '../../core/model/types';
import { templateFor } from '../../core/citation/styles';
import { isCustomBaseStyleId } from '../../core/citation/parse';
import { compileCsl, applyRulesToItem, applyDoiFormat } from '../../core/citation/compile';

/** Resolves a citation-js template name to its CSL XML, or undefined. */
export type CslLoader = (template: string) => Promise<string | undefined>;

function cslConfig(): {
  templates: { add(name: string, csl: string): void; get?(name: string): unknown };
} {
  return plugins.config.get('@csl') as {
    templates: { add(name: string, csl: string): void; get?(name: string): unknown };
  };
}

/** Small deterministic hash so a (style, rules) pair maps to a stable template name. */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export class CiteJsFormatter implements CitationFormatter {
  private readonly registered = new Set<string>();
  private readonly loaded = new Map<string, string | undefined>();

  constructor(private readonly load: CslLoader) {}

  /** Load a base style's XML once, remembering misses as well as hits. */
  private async baseCsl(template: string): Promise<string | undefined> {
    if (!this.loaded.has(template)) this.loaded.set(template, await this.load(template));
    return this.loaded.get(template);
  }

  /**
   * Register a base style with citation-js and return the name to format under.
   *
   * An **imported** style can change under a stable id, and citation-js caches
   * its citeproc engines by template name with no way to evict one — so the
   * name carries a hash of the XML. A re-imported file is simply a different
   * template, which is the only way to be sure the new rules take effect.
   * Vendored styles keep their plain names: their XML cannot change at runtime.
   */
  private async ensureTemplate(nameOrId: string): Promise<{ template: string; csl?: string }> {
    const csl = await this.baseCsl(nameOrId);
    const template = csl && isCustomBaseStyleId(nameOrId) ? `${nameOrId}#${hash(csl)}` : nameOrId;
    if (csl && !this.registered.has(template)) {
      cslConfig().templates.add(template, csl);
      this.registered.add(template);
    }
    return csl ? { template, csl } : { template };
  }

  /** Drop a cached style so the next use re-reads it from storage. */
  forget(template: string): void {
    this.loaded.delete(template);
  }

  async bibliography(items: CslItem[], template: string): Promise<string> {
    const { template: name } = await this.ensureTemplate(template);
    return new Cite(items)
      .format('bibliography', { format: 'text', template: name, lang: 'en-US' })
      .trim();
  }

  async inText(items: CslItem[], template: string): Promise<string> {
    const { template: name } = await this.ensureTemplate(template);
    return new Cite(items)
      .format('citation', { format: 'text', template: name, lang: 'en-US' })
      .trim();
  }

  async compileStyle(style: CitationStyle): Promise<string> {
    const baseCsl = await this.baseCsl(templateFor(style.baseStyleId));
    return baseCsl ? compileCsl(baseCsl, style.userRules) : '';
  }

  async formatWithStyle(
    items: CslItem[],
    style: CitationStyle,
    kind: CitationKind,
  ): Promise<string> {
    const { template: baseTemplate, csl } = await this.ensureTemplate(templateFor(style.baseStyleId));
    const rules = style.userRules;
    const compiled = csl ? compileCsl(csl, rules) : '';
    let template = baseTemplate;

    if (compiled) {
      // The base XML goes into the hash as well as the rules: a re-imported
      // style must not be served by the engine built from the old file.
      const name = `custom:${hash(`${baseTemplate}:${JSON.stringify(rules)}`)}`;
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
