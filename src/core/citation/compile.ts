/**
 * Compile a base CSL style + user rules into an overridden CSL style that
 * citeproc formats. Pure string transforms — no DOM, no `chrome.*` — so it runs
 * in the service worker and is unit-testable.
 *
 * Three levers, in order of how much of the CSL machinery they touch:
 *  - `compileCsl` injects the citeproc-honored name attributes (`and`,
 *    `et-al-min`, `et-al-use-first`) onto every `<name …>` element of the base
 *    style, so author truncation and the final-name joiner reflect the rules.
 *  - `applyRulesToItem` reshapes the CSL-JSON item (dropping identifiers,
 *    labelling page ranges, applying the FOI / legal templates) — controlled
 *    post-processing, as `doc/citations.md` allows, and far more robust than
 *    rewriting bibliography macros.
 *  - `applyDoiFormat` rewrites the rendered text for the one rule that no CSL
 *    attribute expresses: printing a DOI as `doi:…` rather than a full URI.
 *
 * The citation *system* (author–date / footnote / numeric) is deliberately not
 * a lever here: it is declared by the base style itself (`citationFormatOf`),
 * so the editor switches base style instead of trying to convert one.
 */
import type { CitationUserRules } from '../model/types';

/** Set (replacing any existing) an attribute on every `<name …>` element.
 * Deliberately does NOT touch `<names>` (a different CSL element). */
function setNameAttr(xml: string, attr: string, value: string): string {
  return xml.replace(
    /<name(?=[\s/>])([^>]*?)(\/?)>/g,
    (_full, attrs: string, selfClose: string) => {
      const cleaned = attrs.replace(new RegExp(`\\s${attr}="[^"]*"`, 'g'), '');
      return `<name ${attr}="${value}"${cleaned}${selfClose}>`;
    },
  );
}

/** Compile the base CSL XML into a rules-overridden CSL style string. */
export function compileCsl(baseCslXml: string, rules: CitationUserRules): string {
  let xml = baseCslXml;
  xml = setNameAttr(xml, 'and', rules.nameAnd === 'text' ? 'text' : 'symbol');
  xml = setNameAttr(xml, 'et-al-min', String(Math.max(2, rules.maxAuthors + 1)));
  xml = setNameAttr(
    xml,
    'et-al-use-first',
    String(Math.max(1, Math.min(rules.etAlUseFirst, rules.maxAuthors))),
  );
  // APA-style styles set `et-al-use-last` (show the final author after an
  // ellipsis for 21+ authors). Force plain "first N, et al." truncation so the
  // user's maxAuthors rule behaves predictably across base styles.
  xml = setNameAttr(xml, 'et-al-use-last', 'false');
  if (rules.pagePrefix) xml = addPageLabels(xml);
  return xml;
}

/**
 * Prepend a short page label (`p.` / `pp.`, pluralised by citeproc) to every
 * rendered page range. Done in CSL rather than on the item, because citeproc
 * parses and re-formats the `page` variable and would strip a literal prefix.
 * The pair is wrapped in a `<group>` so the enclosing group's delimiter does
 * not land between the label and the range.
 */
function addPageLabels(xml: string): string {
  return xml.replace(
    /<text variable="page"([^>]*)\/>/g,
    '<group><label variable="page" form="short" suffix=" "/><text variable="page"$1/></group>',
  );
}

/** `<category citation-format="…"/>` as declared by a CSL style, if any. */
export function citationFormatOf(cslXml: string): string | undefined {
  return /<category\s[^>]*citation-format="([^"]+)"/.exec(cslXml)?.[1];
}

/**
 * Return a copy of a CSL-JSON item reshaped by the rules: identifiers removed,
 * page ranges labelled, and the special-source templates applied.
 */
export function applyRulesToItem(
  item: Record<string, unknown>,
  rules: CitationUserRules,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  if (!rules.includeDoi) delete out.DOI;
  if (!rules.includeUrl) delete out.URL;
  if (!rules.includeIssue) delete out.issue;

  // FOI requests are CSL `report`s with an issuing `authority`; the template
  // adds the descriptor that styles render alongside the title.
  if (out.type === 'report' && out.authority) {
    if (rules.foiTemplate) out.genre ??= 'Freedom of Information request';
    else delete out.genre;
  }

  // Without the legal template a case cites bare (name + year); with it, the
  // neutral citation and the court are kept.
  if (out.type === 'legal_case' && !rules.legalTemplate) {
    delete out.authority;
    delete out['container-title'];
  }

  return out;
}

/**
 * Rewrite rendered DOIs to the bare `doi:…` form. No CSL attribute expresses
 * this choice, so it is applied to the formatted string.
 */
export function applyDoiFormat(text: string, rules: CitationUserRules): string {
  if (!rules.includeDoi || rules.doiAsUri) return text;
  return text.replace(/https?:\/\/(?:dx\.)?doi\.org\//g, 'doi:');
}

/**
 * The JSON override object shown in the editor's "CSL override" code view.
 * Mirrors the design mock's `cslObject`; a human-readable summary of the rules,
 * not the compiled CSL XML itself.
 */
export function overrideObject(
  name: string,
  baseStyleId: string,
  rules: CitationUserRules,
): Record<string, unknown> {
  return {
    info: { 'base-style': baseStyleId, title: name },
    citation: {
      format: rules.system,
      'et-al-min': rules.maxAuthors + 1,
      'et-al-use-first': rules.etAlUseFirst,
      'name-and': rules.nameAnd,
    },
    bibliography: {
      'include-issue': rules.includeIssue,
      'page-range-prefix': rules.pagePrefix,
      'include-doi': rules.includeDoi,
      'doi-as-uri': rules.doiAsUri,
      'url-if-no-doi': rules.includeUrl,
    },
    'custom-templates': {
      'foi-request': rules.foiTemplate,
      'legal-case': rules.legalTemplate,
    },
  };
}
