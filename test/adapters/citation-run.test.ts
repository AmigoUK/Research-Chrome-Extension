import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { CiteJsFormatter, UnknownCitationIdError } from '../../src/adapters/citation/citejs';
import { templateFor } from '../../src/core/citation/styles';

/** Load a vendored CSL the way the worker does — from disk, not inlined. */
const loader = (name: string): Promise<string | undefined> =>
  readFile(new URL(`../../src/assets/csl/${name}.csl`, import.meta.url), 'utf8').catch(
    () => undefined,
  );

const items = [
  {
    id: 'A',
    type: 'article-journal',
    title: 'Adoption barriers',
    'container-title': 'Agronomy',
    volume: '8',
    issue: '3',
    page: '150-161',
    issued: { 'date-parts': [[2016]] },
    author: [
      { family: 'Nowak', given: 'Anna' },
      { family: 'Kowalski', given: 'Bartosz' },
    ],
  },
  {
    id: 'B',
    type: 'article-journal',
    title: 'Precision farming uptake',
    'container-title': 'Field Crops',
    volume: '12',
    page: '1-14',
    issued: { 'date-parts': [[2016]] },
    author: [
      { family: 'Nowak', given: 'Anna' },
      { family: 'Kowalski', given: 'Bartosz' },
    ],
  },
  {
    id: 'C',
    type: 'article-journal',
    title: 'Subsidy effects',
    'container-title': 'Land Use Policy',
    volume: '99',
    page: '40-52',
    issued: { 'date-parts': [[2020]] },
    author: [{ family: 'Lis', given: 'Cezary' }],
  },
];

/** Cited order of a real draft: C first, then A, then B, then A again. */
const order = ['C', 'A', 'B', 'A'];

// citeproc compiles a style on first use; these suites are slower than a unit
// test and have gone flaky at the default timeout under parallel load.
describe('formatRun', { timeout: 30_000 }, () => {
  let formatter: CiteJsFormatter;
  beforeAll(() => {
    formatter = new CiteJsFormatter(loader);
  });

  it('numbers a Vancouver draft in citation order, and the bibliography agrees', async () => {
    const out = await formatter.formatRun({ items, order }, templateFor('vancouver'), 'text');

    // Assert the CORRESPONDENCE, not the strings: separate assertions would
    // both pass while the in-text numbers pointed at the wrong entries.
    const numbers = out.inText.map((c) => Number(c.replace(/\D/g, '')));
    expect(numbers).toEqual([1, 2, 3, 2]);

    const lines = out.bibliography.split('\n').filter((l) => l.trim().length > 0);
    const titleAt = (n: number): string => lines[n - 1] ?? '';
    expect(titleAt(numbers[0]!)).toContain('Subsidy effects'); // C
    expect(titleAt(numbers[1]!)).toContain('Adoption barriers'); // A
    expect(titleAt(numbers[2]!)).toContain('Precision farming'); // B
  });

  it('disambiguates the FIRST occurrence too, not only the later one', async () => {
    // With `citationsPre` alone this returns "(Nowak and Kowalski 2016)" for the
    // first A and "2016a" for the last — the same source cited two ways.
    const out = await formatter.formatRun({ items, order }, templateFor('harvard-solent'), 'text');
    expect(out.inText[1]).toContain('2016a');
    expect(out.inText[2]).toContain('2016b');
  });

  it('renders a repeated source identically wherever it appears', async () => {
    const out = await formatter.formatRun({ items, order }, templateFor('apa'), 'text');
    expect(out.inText[3]).toBe(out.inText[1]);
  });

  it('emits italics in the html flavour, so a paste into a word processor keeps them', async () => {
    const out = await formatter.formatRun({ items, order }, templateFor('apa'), 'html');
    expect(out.bibliography).toContain('<i>');
  });

  it('passes the flavour to the citation call too, not just the bibliography one', async () => {
    // The bibliography assertion above would still pass if the citation call
    // hardcoded `format: 'text'` — it only checks bibliography markup. Compare
    // the in-text output across flavours so that gap is covered too.
    const textOut = await formatter.formatRun({ items, order }, templateFor('apa'), 'text');
    const htmlOut = await formatter.formatRun({ items, order }, templateFor('apa'), 'html');
    expect(htmlOut.inText).not.toEqual(textOut.inText);
  });

  it('cites only what the draft uses', async () => {
    const out = await formatter.formatRun({ items, order: ['C'] }, templateFor('apa'), 'text');
    expect(out.inText).toHaveLength(1);
    expect(out.bibliography).toContain('Subsidy effects');
    expect(out.bibliography).not.toContain('Adoption barriers');
  });

  it('returns nothing to cite for an empty draft', async () => {
    const out = await formatter.formatRun({ items, order: [] }, templateFor('apa'), 'text');
    expect(out.inText).toEqual([]);
    expect(out.bibliography).toBe('');
  });

  it('names the missing id when a draft cites a reference that is not in items', async () => {
    // The realistic cause: a reference the draft cites was deleted from the
    // project. citeproc's own failure for the same miss is an opaque
    // "Cannot find entry with id '...'" naming neither the draft nor the
    // method — this must fail with a named error that names the id instead.
    const run = { items, order: ['C', 'ghost'] };
    await expect(formatter.formatRun(run, templateFor('apa'), 'text')).rejects.toThrow(
      UnknownCitationIdError,
    );
    await expect(formatter.formatRun(run, templateFor('apa'), 'text')).rejects.toThrow(/ghost/);
  });
});
