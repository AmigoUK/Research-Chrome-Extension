import { describe, it, expect } from 'vitest';
import { CiteJsFormatter } from '../../src/adapters/citation/citejs';
import type { CslItem } from '../../src/core/ports/citation';
import type { CitationStyle, CitationUserRules } from '../../src/core/model/types';

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
});
