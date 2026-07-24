import { describe, it, expect } from 'vitest';
import {
  compileCsl,
  applyRulesToItem,
  overrideObject,
  citationFormatOf,
  applyDoiFormat,
} from './compile';
import type { CitationUserRules } from '../model/types';

const RULES: CitationUserRules = {
  system: 'authorDate',
  maxAuthors: 3,
  etAlUseFirst: 1,
  nameAnd: 'text',
  includeDoi: true,
  doiAsUri: true,
  includeUrl: false,
  includeIssue: true,
  pagePrefix: false,
  foiTemplate: false,
  legalTemplate: false,
};

const CSL = `<style>
  <citation><layout><names variable="author"><name and="symbol" et-al-min="21" delimiter=", "/></names></layout></citation>
  <bibliography><layout><names variable="author"><name and="symbol" et-al-min="21" et-al-use-first="19"/></names></layout></bibliography>
</style>`;

describe('compileCsl', () => {
  it('injects name attributes from the rules onto every <name> element', () => {
    const out = compileCsl(CSL, RULES);
    // Two <name> elements, both updated.
    expect(out.match(/and="text"/g)).toHaveLength(2);
    expect(out.match(/et-al-min="4"/g)).toHaveLength(2); // maxAuthors + 1
    expect(out.match(/et-al-use-first="1"/g)).toHaveLength(2);
    // The old symbol/21 values are gone.
    expect(out).not.toContain('and="symbol"');
    expect(out).not.toContain('et-al-min="21"');
  });

  it('does not disturb <names> container elements', () => {
    const out = compileCsl(CSL, RULES);
    expect(out.match(/<names variable="author">/g)).toHaveLength(2);
  });

  it('clamps et-al-use-first to at most maxAuthors and at least 1', () => {
    const out = compileCsl(CSL, { ...RULES, maxAuthors: 2, etAlUseFirst: 9 });
    expect(out).toContain('et-al-use-first="2"');
    expect(out).toContain('et-al-min="3"');
  });

  it('uses the ampersand joiner when nameAnd is symbol', () => {
    expect(compileCsl(CSL, { ...RULES, nameAnd: 'symbol' })).toContain('and="symbol"');
  });

  it('adds a short page label before every page range when pagePrefix is on', () => {
    const csl = `<style><bibliography><layout><text variable="page"/></layout></bibliography></style>`;
    expect(compileCsl(csl, RULES)).not.toContain('<label variable="page"');
    const labelled = compileCsl(csl, { ...RULES, pagePrefix: true });
    expect(labelled).toContain(
      '<group><label variable="page" form="short" suffix=" "/><text variable="page"/></group>',
    );
  });
});

describe('applyRulesToItem', () => {
  const item = { title: 'X', DOI: '10.1/x', URL: 'https://e.org', issue: '3', volume: '5' };

  it('keeps identifiers that are enabled', () => {
    const out = applyRulesToItem(item, RULES);
    expect(out.DOI).toBe('10.1/x');
    expect(out.issue).toBe('3');
    expect(out.URL).toBeUndefined(); // includeUrl false
    expect(out.volume).toBe('5');
  });

  it('drops DOI, URL and issue when disabled', () => {
    const out = applyRulesToItem(item, {
      ...RULES,
      includeDoi: false,
      includeUrl: false,
      includeIssue: false,
    });
    expect(out.DOI).toBeUndefined();
    expect(out.URL).toBeUndefined();
    expect(out.issue).toBeUndefined();
    expect(out.volume).toBe('5');
  });

  it('does not mutate the input', () => {
    applyRulesToItem(item, { ...RULES, includeIssue: false });
    expect(item.issue).toBe('3');
  });

  it('labels an FOI report with a genre only when the FOI template is on', () => {
    const foi = { type: 'report', authority: 'Environment Agency', number: 'EA/2023/0456' };
    expect(applyRulesToItem(foi, RULES).genre).toBeUndefined();
    expect(applyRulesToItem(foi, { ...RULES, foiTemplate: true }).genre).toBe(
      'Freedom of Information request',
    );
  });

  it('keeps the court on a legal case only when the legal template is on', () => {
    const legal = { type: 'legal_case', authority: 'High Court', number: '[2021] EWHC 1234' };
    expect(applyRulesToItem(legal, RULES).authority).toBeUndefined();
    const on = applyRulesToItem(legal, { ...RULES, legalTemplate: true });
    expect(on.authority).toBe('High Court');
    expect(on.number).toBe('[2021] EWHC 1234');
  });
});

describe('applyDoiFormat', () => {
  const text = 'Oke, T. R. (1982). Title. Journal, 108(455), 1–24. https://doi.org/10.1002/qj.497';

  it('leaves DOI URIs alone when doiAsUri is on', () => {
    expect(applyDoiFormat(text, RULES)).toContain('https://doi.org/10.1002/qj.497');
  });

  it('rewrites DOI URIs to the bare doi: form when doiAsUri is off', () => {
    const out = applyDoiFormat(text, { ...RULES, doiAsUri: false });
    expect(out).toContain('doi:10.1002/qj.497');
    expect(out).not.toContain('https://doi.org/');
  });

  it('is a no-op when DOIs are excluded entirely', () => {
    const plain = 'Oke, T. R. (1982). Title.';
    expect(applyDoiFormat(plain, { ...RULES, includeDoi: false, doiAsUri: false })).toBe(plain);
  });
});

describe('citationFormatOf', () => {
  it('reads the citation-format category declared by a CSL style', () => {
    const csl = `<style><info><category citation-format="note"/></info></style>`;
    expect(citationFormatOf(csl)).toBe('note');
  });

  it('returns undefined when the style declares no citation format', () => {
    expect(citationFormatOf('<style><info></info></style>')).toBeUndefined();
  });
});

describe('overrideObject', () => {
  it('summarises the rules into the CSL-override shape', () => {
    const o = overrideObject('APA 7th', 'apa', RULES) as {
      info: { title: string };
      citation: { 'et-al-min': number; 'name-and': string };
      bibliography: { 'include-doi': boolean };
    };
    expect(o.info.title).toBe('APA 7th');
    expect(o.citation['et-al-min']).toBe(4);
    expect(o.citation['name-and']).toBe('text');
    expect(o.bibliography['include-doi']).toBe(true);
  });
});
