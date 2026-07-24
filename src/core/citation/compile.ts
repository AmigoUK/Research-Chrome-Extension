/**
 * Compile a base CSL style + user rules into an overridden CSL style that
 * citeproc formats. Pure string transforms — no DOM, no `chrome.*` — so it runs
 * in the service worker and is unit-testable.
 *
 * Two levers:
 *  - `compileCsl` injects the citeproc-honored name attributes (`and`,
 *    `et-al-min`, `et-al-use-first`) onto every `<name …>` element of the base
 *    style, so author truncation and the final-name joiner reflect the rules.
 *  - `applyRulesToItem` drops `DOI` / `URL` / `issue` from a CSL-JSON item per
 *    the inclusion rules — a robust way to change output without touching CSL.
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
  return xml;
}

/** Return a copy of a CSL-JSON item with identifiers removed per the rules. */
export function applyRulesToItem(
  item: Record<string, unknown>,
  rules: CitationUserRules,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...item };
  if (!rules.includeDoi) delete out.DOI;
  if (!rules.includeUrl) delete out.URL;
  if (!rules.includeIssue) delete out.issue;
  return out;
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
