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
import type {
  CitationFormatter,
  CitationKind,
  CitationRun,
  CitationRunOutput,
  CslItem,
} from '../../core/ports/citation';
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

  /**
   * Resolve a `CitationStyle` to the template name it should format under:
   * the base CSL compiled with the style's user rules, registered as a
   * `custom:${hash(...)}` template, or the plain base template when there is
   * nothing to compile. Shared by `formatWithStyle` and `formatRun` — both
   * need the same custom-style resolution, just against a different call to
   * citeproc afterwards.
   */
  private async styleTemplate(style: CitationStyle): Promise<string> {
    const { template: baseTemplate, csl } = await this.ensureTemplate(
      templateFor(style.baseStyleId),
    );
    const rules = style.userRules;
    const compiled = csl ? compileCsl(csl, rules) : '';
    if (!compiled) return baseTemplate;

    // The base XML goes into the hash as well as the rules: a re-imported
    // style must not be served by the engine built from the old file.
    const name = `custom:${hash(`${baseTemplate}:${JSON.stringify(rules)}`)}`;
    if (!this.registered.has(name)) {
      cslConfig().templates.add(name, compiled);
      this.registered.add(name);
    }
    return name;
  }

  async formatWithStyle(
    items: CslItem[],
    style: CitationStyle,
    kind: CitationKind,
  ): Promise<string> {
    const template = await this.styleTemplate(style);
    const rules = style.userRules;
    const processed = items.map((item) => applyRulesToItem(item, rules));
    const type = kind === 'bibliography' ? 'bibliography' : 'citation';
    const text = new Cite(processed)
      .format(type, { format: 'text', template, lang: 'en-US' })
      .trim();
    return applyDoiFormat(text, rules);
  }

  async formatRun(
    run: CitationRun,
    template: string,
    flavour: 'text' | 'html',
    style?: CitationStyle,
  ): Promise<CitationRunOutput> {
    if (run.order.length === 0) return { inText: [], bibliography: '' };

    // Resolve the template exactly as the other methods do, so a user's
    // compiled rules apply here too.
    const name = style
      ? await this.styleTemplate(style)
      : (await this.ensureTemplate(template)).template;
    const rules = style?.userRules;
    const processed = run.items.map((item) => (rules ? applyRulesToItem(item, rules) : item));

    // Only the sources the draft actually cites, ordered by FIRST citation:
    // Vancouver numbers its reference list that way, and a bibliography built
    // on input order would disagree with the numbers in the text. Author-date
    // styles sort themselves, so this ordering is a no-op for them.
    const firstCited = [...new Set(run.order)];
    const byId = new Map(processed.map((i) => [String((i as { id?: unknown }).id), i]));
    const cited = firstCited.map((id) => byId.get(id)).filter((i): i is CslItem => i !== undefined);

    const cite = new Cite(processed);
    const inText = run.order.map((id, i) =>
      cite
        .format('citation', {
          format: flavour,
          template: name,
          lang: 'en-US',
          entry: [id],
          // Both sides, not just `citationsPre`: citeproc disambiguates
          // retroactively, so a cluster that cannot see the ones after it
          // freezes an answer that stops being true further down the draft.
          citationsPre: run.order.slice(0, i).map((p) => [p]),
          citationsPost: run.order.slice(i + 1).map((p) => [p]),
        })
        .trim(),
    );

    const bibliography = new Cite(cited)
      .format('bibliography', { format: flavour, template: name, lang: 'en-US' })
      .trim();

    return {
      inText: rules ? inText.map((t) => applyDoiFormat(t, rules)) : inText,
      bibliography: rules ? applyDoiFormat(bibliography, rules) : bibliography,
    };
  }
}
