import { describe, it, expect } from 'vitest';
import { CiteJsFormatter, BASE_CSL } from '../../src/adapters/citation/citejs';
import type { CslItem } from '../../src/core/ports/citation';
import type { CitationStyle, CitationUserRules } from '../../src/core/model/types';
import { BASE_STYLES, templateFor } from '../../src/core/citation/styles';
import { citationFormatOf } from '../../src/core/citation/compile';

const formatter = new CiteJsFormatter();

// A four-author journal article with a DOI.
const ITEM: CslItem = {
  id: 'c',
  type: 'article-journal',
  title: 'Mortality risk attributable to high and low ambient temperature',
  author: [
    { family: 'Gasparrini', given: 'A.' },
    { family: 'Guo', given: 'Y.' },
    { family: 'Hashizume', given: 'M.' },
    { family: 'Lavigne', given: 'E.' },
  ],
  issued: { 'date-parts': [[2015]] },
  'container-title': 'The Lancet',
  volume: '386',
  issue: '9991',
  page: '369-375',
  DOI: '10.1016/S0140-6736(14)62114-0',
};

const baseRules: CitationUserRules = {
  system: 'authorDate',
  maxAuthors: 20,
  etAlUseFirst: 19,
  nameAnd: 'symbol',
  includeDoi: true,
  doiAsUri: true,
  includeUrl: false,
  includeIssue: true,
  pagePrefix: false,
  foiTemplate: false,
  legalTemplate: false,
};
const style = (over: Partial<CitationUserRules>): CitationStyle => ({
  id: `s-${JSON.stringify(over)}`,
  name: 'Test',
  baseStyleId: 'apa',
  userRules: { ...baseRules, ...over },
});

describe('CiteJsFormatter.formatWithStyle — rules drive real citeproc output', () => {
  it('truncates the author list to "et al." when maxAuthors is small', () => {
    const full = formatter.formatWithStyle([ITEM], style({ maxAuthors: 20 }), 'bibliography');
    const truncated = formatter.formatWithStyle([ITEM], style({ maxAuthors: 1 }), 'bibliography');
    expect(full).toContain('Hashizume');
    expect(full).not.toContain('et al.');
    expect(truncated).toContain('et al.');
    expect(truncated).not.toContain('Hashizume');
  });

  it('drops the DOI from the bibliography when includeDoi is false', () => {
    const withDoi = formatter.formatWithStyle([ITEM], style({ includeDoi: true }), 'bibliography');
    const withoutDoi = formatter.formatWithStyle(
      [ITEM],
      style({ includeDoi: false }),
      'bibliography',
    );
    expect(withDoi).toContain('10.1016');
    expect(withoutDoi).not.toContain('10.1016');
  });

  it('drops the issue number when includeIssue is false', () => {
    const withIssue = formatter.formatWithStyle(
      [ITEM],
      style({ includeIssue: true }),
      'bibliography',
    );
    const withoutIssue = formatter.formatWithStyle(
      [ITEM],
      style({ includeIssue: false }),
      'bibliography',
    );
    expect(withIssue).toContain('(9991)');
    expect(withoutIssue).not.toContain('(9991)');
  });

  it('produces a non-empty in-text citation', () => {
    const inText = formatter.formatWithStyle([ITEM], style({}), 'inText');
    expect(inText).toMatch(/Gasparrini/);
    expect(inText).toContain('2015');
  });

  it('prints the DOI as a bare doi: identifier when doiAsUri is off', () => {
    const asUri = formatter.formatWithStyle([ITEM], style({ doiAsUri: true }), 'bibliography');
    const bare = formatter.formatWithStyle([ITEM], style({ doiAsUri: false }), 'bibliography');
    expect(asUri).toContain('https://doi.org/10.1016');
    expect(bare).toContain('doi:10.1016');
    expect(bare).not.toContain('https://doi.org/');
  });

  it('labels the page range when pagePrefix is on', () => {
    const plain = formatter.formatWithStyle([ITEM], style({ pagePrefix: false }), 'bibliography');
    const labelled = formatter.formatWithStyle([ITEM], style({ pagePrefix: true }), 'bibliography');
    expect(plain).not.toContain('pp. 369');
    expect(labelled).toContain('pp. 369');
  });

  it('renders the FOI descriptor only when the FOI template is on', () => {
    const foi: CslItem = {
      id: 'foi',
      type: 'report',
      title: 'Automatic monitoring station metadata',
      authority: 'Environment Agency',
      number: 'EA/2023/0456',
      issued: { 'date-parts': [[2023, 5, 12]] },
    };
    const off = formatter.formatWithStyle([foi], style({ foiTemplate: false }), 'bibliography');
    const on = formatter.formatWithStyle([foi], style({ foiTemplate: true }), 'bibliography');
    expect(off).not.toContain('Freedom of Information');
    // APA title-cases the genre it renders alongside the report number.
    expect(on).toMatch(/Freedom of Information Request EA\/2023\/0456/i);
  });

  it('keeps the court on a legal case only when the legal template is on', () => {
    const legal: CslItem = {
      id: 'case',
      type: 'legal_case',
      title: 'R (ClientEarth) v Secretary of State',
      authority: 'High Court',
      number: '[2021] EWHC 1234 (Admin)',
      issued: { 'date-parts': [[2021]] },
    };
    const off = formatter.formatWithStyle([legal], style({ legalTemplate: false }), 'bibliography');
    const on = formatter.formatWithStyle([legal], style({ legalTemplate: true }), 'bibliography');
    expect(off).not.toContain('High Court');
    expect(on).toContain('High Court');
  });

  it('formats a footnote base style as a note, not an author–date parenthesis', () => {
    const note = { ...style({}), baseStyleId: 'chicago-note' };
    const inText = formatter.formatWithStyle([ITEM], note, 'inText');
    expect(inText).toContain('Gasparrini');
    expect(inText).not.toMatch(/^\(/); // notes are not parenthetical
  });
});

describe('BASE_STYLES matches the vendored CSL files', () => {
  const DECLARED: Record<string, 'authorDate' | 'footnote' | 'numeric'> = {
    'author-date': 'authorDate',
    author: 'authorDate',
    note: 'footnote',
    numeric: 'numeric',
    label: 'numeric',
  };

  it.each(BASE_STYLES.map((s) => [s.id, s.system] as const))(
    'declares %s as %s, as the CSL file itself does',
    (id, system) => {
      const csl = BASE_CSL[templateFor(id)];
      expect(csl, `no vendored CSL for ${id}`).toBeTruthy();
      const format = citationFormatOf(csl!);
      expect(format, `${id} declares no citation-format`).toBeTruthy();
      expect(DECLARED[format!]).toBe(system);
    },
  );
});
