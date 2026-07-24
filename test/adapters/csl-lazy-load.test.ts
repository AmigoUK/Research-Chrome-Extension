import { describe, it, expect } from 'vitest';
import { CiteJsFormatter, type CslLoader } from '../../src/adapters/citation/citejs';
import { createFsCslLoader } from '../support/csl-loader';
import type { CitationStyle, CitationUserRules } from '../../src/core/model/types';

const rules: CitationUserRules = {
  system: 'authorDate',
  maxAuthors: 3,
  etAlUseFirst: 1,
  nameAnd: 'symbol',
  includeDoi: true,
  doiAsUri: true,
  includeUrl: false,
  includeIssue: true,
  pagePrefix: false,
  foiTemplate: false,
  legalTemplate: false,
};
const style = (baseStyleId: string): CitationStyle => ({
  id: `s-${baseStyleId}`,
  name: baseStyleId,
  baseStyleId,
  userRules: rules,
});

const ITEM = { id: 'x', type: 'article-journal', title: 'A paper' };

/** Wraps a loader, recording which templates were actually asked for. */
function counting(inner: CslLoader): { load: CslLoader; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    load: (template) => {
      asked.push(template);
      return inner(template);
    },
  };
}

describe('base styles are loaded lazily', () => {
  it('asks for nothing until a style is actually used', () => {
    const { asked } = counting(createFsCslLoader());
    new CiteJsFormatter(createFsCslLoader());
    expect(asked).toEqual([]);
  });

  it('loads only the style in play, and only once', async () => {
    const { load, asked } = counting(createFsCslLoader());
    const formatter = new CiteJsFormatter(load);

    await formatter.formatWithStyle([ITEM], style('apa'), 'bibliography');
    await formatter.formatWithStyle([ITEM], style('apa'), 'inText');
    await formatter.compileStyle(style('apa'));

    // The 243 kB Chicago notes file is never touched by an APA session.
    expect(asked).toEqual(['apa']);
  });

  it('loads a second style only when that style is used', async () => {
    const { load, asked } = counting(createFsCslLoader());
    const formatter = new CiteJsFormatter(load);

    await formatter.compileStyle(style('apa'));
    expect(asked).toEqual(['apa']);

    await formatter.compileStyle(style('chicago-note'));
    expect(asked).toEqual(['apa', 'chicago-notes-bibliography']);
  });

  it('degrades to an empty compile when a style cannot be loaded', async () => {
    const formatter = new CiteJsFormatter(() => Promise.resolve(undefined));
    expect(await formatter.compileStyle(style('apa'))).toBe('');
  });

  it('remembers a miss instead of retrying it on every call', async () => {
    const { load, asked } = counting(() => Promise.resolve(undefined));
    const formatter = new CiteJsFormatter(load);

    await formatter.compileStyle(style('apa'));
    await formatter.compileStyle(style('apa'));

    expect(asked).toEqual(['apa']);
  });
});
