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
   * Register a base style with citation-js if it is not one of the templates the
   * plugin already ships. Registering the same name twice is harmless, so the
   * `registered` set is an optimisation, not a correctness guard.
   */
  private async ensureTemplate(template: string): Promise<void> {
    if (this.registered.has(template)) return;
    const csl = await this.baseCsl(template);
    if (csl) cslConfig().templates.add(template, csl);
    this.registered.add(template);
  }

  async bibliography(items: CslItem[], template: string): Promise<string> {
    await this.ensureTemplate(template);
    return new Cite(items)
      .format('bibliography', { format: 'text', template, lang: 'en-US' })
      .trim();
  }

  async inText(items: CslItem[], template: string): Promise<string> {
    await this.ensureTemplate(template);
    return new Cite(items).format('citation', { format: 'text', template, lang: 'en-US' }).trim();
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
    const baseTemplate = templateFor(style.baseStyleId);
    await this.ensureTemplate(baseTemplate);
    const compiled = await this.compileStyle(style);
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
