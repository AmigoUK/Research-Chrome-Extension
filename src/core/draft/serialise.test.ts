import { describe, it, expect } from 'vitest';
import { draftToHtml, draftToMarkdown, DraftFlavourMismatchError } from './serialise';
import type { Draft } from '../usecases/draft';

const draft: Draft = {
  flavour: 'html',
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

// Same draft, only the flavour differs — draftToMarkdown requires 'text'
// (Fix round 1, item 1). Kept as a second named fixture rather than a
// per-test `{ ...draft, flavour: 'text' }` sprinkled everywhere, since every
// draftToMarkdown test needs it.
const textDraft: Draft = { ...draft, flavour: 'text' };

describe('draftToHtml', () => {
  // Fix round 1, item 2 (dueDate added in Fix round 2, item 2): each hostile
  // field below carries its own marker tag AND its own `&`, so no assertion
  // can be satisfied by a DIFFERENT field's escaped output — the original
  // version of this test used '<script>' for the quote and 'me & you' for the
  // note but only ever asserted the quote's escaped form and an ampersand
  // that happened to come from the quote's own tail, so deleting the note's
  // `escapeHtml` call left the suite green. `dueDate` was added after
  // round 1's own "prints the due date" test turned out to use a value
  // ('2026-08-10') with no metacharacters, so it passed identically escaped
  // or not. Verified by removing each `escapeHtml(...)` call below one at a
  // time and confirming exactly its own pair of assertions goes red — see
  // the Fix round 1/2 report for which were checked.
  it('escapes every page-derived field independently and leaves citeproc markup alone', () => {
    const hostile: Draft = {
      ...draft,
      projectName: 'Essay <ptag> & pamp',
      researchQuestion: 'RQ <rtag> & ramp',
      dueDate: '2026-08-10 <dtag> & damp',
      sections: [
        {
          id: 's1',
          title: 'Barriers <ttag> & tamp',
          entries: [
            {
              annotationId: 'a1',
              quote: 'Quote <qtag> & qamp',
              note: 'Note <ntag> & namp',
              inTextFormatted: '(Nowak, 2016)',
              locator: 'PDF p. 4 <ltag> & lamp',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(hostile);

    expect(html).toContain('Essay &lt;ptag&gt; &amp; pamp');
    expect(html).toContain('RQ &lt;rtag&gt; &amp; ramp');
    expect(html).toContain('Due: 2026-08-10 &lt;dtag&gt; &amp; damp');
    expect(html).toContain('Barriers &lt;ttag&gt; &amp; tamp');
    expect(html).toContain('Quote &lt;qtag&gt; &amp; qamp');
    expect(html).toContain('Note &lt;ntag&gt; &amp; namp');
    expect(html).toContain('PDF p. 4 &lt;ltag&gt; &amp; lamp');

    expect(html).not.toContain('<ptag>');
    expect(html).not.toContain('<rtag>');
    expect(html).not.toContain('<dtag>');
    expect(html).not.toContain('<ttag>');
    expect(html).not.toContain('<qtag>');
    expect(html).not.toContain('<ntag>');
    expect(html).not.toContain('<ltag>');

    expect(html).toContain('<i>Agronomy</i>'); // citeproc's own markup survives intact
  });

  it('keeps the research question and the section heading', () => {
    const html = draftToHtml(draft);
    expect(html).toContain('Did subsidies increase adoption?');
    expect(html).toContain('Barriers');
  });

  it('prints the due date', () => {
    expect(draftToHtml(draft)).toContain('Due: 2026-08-10');
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

  // Fix round 1, item 4: citationHtml used to return early on
  // `missingReference` before it ever looked at `entry.locator`, so a PDF
  // region with a captured quote but no bibliographic record lost its only
  // remaining positional information.
  it("keeps a missingReference entry's locator alongside the marker", () => {
    const orphan: Draft = {
      ...draft,
      missingReferenceCount: 1,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              quote: 'A quoted line with no reference.',
              note: '',
              inTextFormatted: '',
              missingReference: true,
              locator: 'PDF p. 4',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(orphan);
    expect(html).toContain('no bibliographic data');
    expect(html).toContain('PDF p. 4');
  });

  // Fix round 2, items 1 & 4: every earlier fixture with a `locator` also had
  // a `quote`, so `body` always took the blockquote branch and the no-quote
  // branch's own (now-removed) locator interpolation was never exercised —
  // deleting its escape left all tests green. Fixing that by centralising
  // locator rendering in citationHtml also closed a real duplicate-output bug
  // (a no-quote, referenced entry with a locator used to print it twice: once
  // from entryHtml's own bracket, once from citationHtml's `where`). This
  // entry has no quote, a resolved citation, and a hostile locator, so it
  // pins both at once: the escaped form is present, and it appears exactly
  // once.
  it("escapes a no-quote entry's locator and shows it exactly once", () => {
    const noQuote: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              note: '',
              inTextFormatted: '(Nowak, 2016)',
              locator: 'PDF p. 9 <loctag> & locamp',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(noQuote);
    expect(html).toContain('PDF p. 9 &lt;loctag&gt; &amp; locamp');
    expect(html).not.toContain('<loctag>');
    expect(html.split('PDF p. 9').length - 1).toBe(1);
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

  // Fix round 1, item 5 (HTML side): raw '\n' collapses to whitespace in
  // rendered/pasted HTML, running a multi-paragraph selection's paragraphs
  // together with no visible break at all.
  it('turns each line of a multi-paragraph quote into its own line with <br>, citation on the last', () => {
    const multi: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              quote: 'First paragraph.\n\nSecond paragraph.',
              note: '',
              inTextFormatted: '(Nowak, 2016)',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(multi);
    expect(html).toContain('First paragraph.<br><br>Second paragraph.');
    expect(html).toContain('(Nowak, 2016)');
    expect(html).not.toContain('\n');
  });

  it('renders an entry with neither quote nor note', () => {
    const bare: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [{ annotationId: 'a1', note: '', inTextFormatted: '(Nowak, 2016)' }],
        },
      ],
    };
    const html = draftToHtml(bare);
    expect(html).toContain('region — no text captured');
    expect(html).toContain('(Nowak, 2016)');
    expect(html).not.toContain('My note');
    expect(html).not.toContain('<blockquote>');
  });

  it('renders a draft with zero sections without throwing', () => {
    const empty: Draft = { ...draft, sections: [], unplaced: [] };
    const html = draftToHtml(empty);
    expect(html).toContain('<h1>Essay</h1>');
    expect(html).not.toContain('Unplaced');
    expect(html).not.toContain('<h2>Barriers</h2>');
  });

  it('omits the References heading when the bibliography is empty', () => {
    expect(draftToHtml({ ...draft, bibliography: '' })).not.toContain('References');
  });

  // Fix round 1, item 1: an 'html'-flavour citeproc run's inTextFormatted and
  // bibliography are only safe to interpolate unescaped because that flavour
  // did the escaping already; a 'text'-flavour draft's citeproc output has
  // none, so this must not be allowed to compile-and-run silently.
  it('refuses to render a text-flavour draft as HTML', () => {
    expect(() => draftToHtml({ ...draft, flavour: 'text' })).toThrow(DraftFlavourMismatchError);
    expect(() => draftToHtml({ ...draft, flavour: 'text' })).toThrow(/does not escape/);
  });
});

describe('draftToMarkdown', () => {
  it('quotes with a blockquote and keeps the citation on the same line', () => {
    const md = draftToMarkdown(textDraft);
    expect(md).toContain('## Barriers');
    expect(md).toContain('> Farmers cited upfront cost. (Nowak &#38; Kowalski, 2016a)');
  });

  it('does not escape — Markdown is not HTML', () => {
    const md = draftToMarkdown({
      ...textDraft,
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

  it('prints the due date', () => {
    expect(draftToMarkdown(textDraft)).toContain('Due: 2026-08-10');
  });

  // Fix round 1, item 5 (Markdown side): an unprefixed blank line closes the
  // blockquote early, and an unprefixed '#' line becomes a heading.
  it('prefixes every line of a multi-paragraph quote so the blockquote survives', () => {
    const multi: Draft = {
      ...textDraft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              quote: 'First paragraph.\n\nSecond paragraph.\n#Not a heading',
              note: '',
              inTextFormatted: '(Nowak, 2016)',
            },
          ],
        },
      ],
    };
    const md = draftToMarkdown(multi);
    expect(md).toContain('> First paragraph.\n>\n> Second paragraph.\n> #Not a heading');
    expect(md).not.toContain('\nSecond paragraph.');
    expect(md).not.toContain('\n#Not a heading\n');
  });

  it('renders an entry with neither quote nor note', () => {
    const bare: Draft = {
      ...textDraft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [{ annotationId: 'a1', note: '', inTextFormatted: '(Nowak, 2016)' }],
        },
      ],
    };
    const md = draftToMarkdown(bare);
    expect(md).toContain('<region — no text captured>');
    expect(md).toContain('(Nowak, 2016)');
    expect(md).not.toContain('My note');
  });

  it('renders a draft with zero sections without throwing', () => {
    const empty: Draft = { ...textDraft, sections: [], unplaced: [] };
    const md = draftToMarkdown(empty);
    expect(md).toContain('# Essay');
    expect(md).not.toContain('Unplaced');
    expect(md).not.toContain('## Barriers');
  });

  it('omits the References heading when the bibliography is empty', () => {
    expect(draftToMarkdown({ ...textDraft, bibliography: '' })).not.toContain('References');
  });

  it('renders unplaced passages last, under their own heading', () => {
    const md = draftToMarkdown({
      ...textDraft,
      unplaced: [{ annotationId: 'u1', note: 'stray', inTextFormatted: '(N, 2016)' }],
    });
    expect(md).toContain('## Unplaced');
    expect(md.indexOf('## Unplaced')).toBeGreaterThan(md.indexOf('## Barriers'));
  });

  // Fix round 1, item 4, Markdown side.
  it("keeps a missingReference entry's locator alongside the marker", () => {
    const orphan: Draft = {
      ...textDraft,
      missingReferenceCount: 1,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1',
              quote: 'A quoted line with no reference.',
              note: '',
              inTextFormatted: '',
              missingReference: true,
              locator: 'PDF p. 4',
            },
          ],
        },
      ],
    };
    const md = draftToMarkdown(orphan);
    expect(md).toContain('no bibliographic data');
    expect(md).toContain('PDF p. 4');
  });

  // Fix round 2, item 4, Markdown side — mirrors the HTML fix: a no-quote,
  // referenced entry with a locator used to show it twice (entryMarkdown's
  // own bracket, plus citationText's `where`).
  it("shows a no-quote entry's locator exactly once", () => {
    const noQuote: Draft = {
      ...textDraft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            { annotationId: 'a1', note: '', inTextFormatted: '(Nowak, 2016)', locator: 'PDF p. 9' },
          ],
        },
      ],
    };
    const md = draftToMarkdown(noQuote);
    expect(md).toContain('PDF p. 9');
    expect(md.split('PDF p. 9').length - 1).toBe(1);
  });

  it('refuses to render an html-flavour draft as Markdown', () => {
    expect(() => draftToMarkdown({ ...textDraft, flavour: 'html' })).toThrow(
      DraftFlavourMismatchError,
    );
    expect(() => draftToMarkdown({ ...textDraft, flavour: 'html' })).toThrow(
      /literal text in a plain-text/,
    );
  });
});
