import { describe, it, expect } from 'vitest';
import { draftToHtml, draftToMarkdown } from './serialise';
import type { Draft } from '../usecases/draft';

const draft: Draft = {
  projectName: 'Essay',
  researchQuestion: 'Did subsidies increase adoption?',
  dueDate: '2026-08-10',
  sections: [
    {
      id: 's1',
      title: 'Barriers',
      entries: [
        {
          annotationId: 'a1',
          quote: 'Farmers cited upfront cost.',
          note: 'contradicts Kowalski',
          inTextFormatted: '(Nowak &#38; Kowalski, 2016a)',
          colorLabel: 'Evidence',
        },
      ],
    },
  ],
  unplaced: [],
  bibliography: '<div class="csl-entry">Nowak, A. (2016a). <i>Agronomy</i>.</div>',
  groupedByColour: false,
  missingReferenceCount: 0,
};

describe('draftToHtml', () => {
  // One test, because it is ONE decision: quote and note are text from
  // arbitrary web pages and must be escaped; citeproc output is markup and
  // must not be. Getting these two backwards is how the injection bug and the
  // "why is my bibliography full of &lt;i&gt;" bug both happen.
  it('escapes what came from a page and leaves citeproc markup alone', () => {
    const hostile: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers <script>',
          entries: [
            {
              annotationId: 'a1',
              quote: '<script>alert(1)</script> & more',
              note: 'me & you',
              inTextFormatted: '(Nowak, 2016)',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
    expect(html).toContain('<i>Agronomy</i>'); // bibliography survives intact
  });

  it('keeps the research question and the section heading', () => {
    const html = draftToHtml(draft);
    expect(html).toContain('Did subsidies increase adoption?');
    expect(html).toContain('Barriers');
  });

  it('puts the citation with its quote', () => {
    expect(draftToHtml(draft)).toContain('(Nowak &#38; Kowalski, 2016a)');
  });

  it('marks a direct quote that has no trustworthy page', () => {
    const pdf: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              quote: 'A quoted line.',
              note: '',
              inTextFormatted: '(Nowak, 2016)',
              locator: 'PDF p. 4',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(pdf);
    expect(html).toContain('[page?]');
    expect(html).toContain('PDF p. 4');
  });

  it('keeps a passage with no citation data and says so', () => {
    const orphan: Draft = {
      ...draft,
      missingReferenceCount: 1,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            { annotationId: 'a1', note: 'my thought', inTextFormatted: '', missingReference: true },
          ],
        },
      ],
    };
    expect(draftToHtml(orphan)).toContain('no bibliographic data');
  });

  it('renders unplaced passages last, under their own heading', () => {
    const html = draftToHtml({
      ...draft,
      unplaced: [{ annotationId: 'u1', note: 'stray', inTextFormatted: '(N, 2016)' }],
    });
    expect(html).toContain('Unplaced');
    expect(html.indexOf('Unplaced')).toBeGreaterThan(html.indexOf('Barriers'));
  });

  it('omits the unplaced heading entirely when nothing is unplaced', () => {
    expect(draftToHtml(draft)).not.toContain('Unplaced');
  });
});

describe('draftToMarkdown', () => {
  it('quotes with a blockquote and keeps the citation on the same line', () => {
    const md = draftToMarkdown(draft);
    expect(md).toContain('## Barriers');
    expect(md).toContain('> Farmers cited upfront cost. (Nowak &#38; Kowalski, 2016a)');
  });

  it('does not escape — Markdown is not HTML', () => {
    const md = draftToMarkdown({
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'T',
          entries: [{ annotationId: 'a1', quote: 'a & b', note: '', inTextFormatted: '' }],
        },
      ],
    });
    expect(md).toContain('a & b');
    expect(md).not.toContain('&amp;');
  });
});
