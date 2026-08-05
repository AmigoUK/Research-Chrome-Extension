import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  composeDraft,
  groupPassages,
  CitationRunLengthMismatchError,
} from '../../src/core/usecases/draft';
import type { CitationFormatter } from '../../src/core/ports/citation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, Document, Project, Reference } from '../../src/core/model/types';

const NOW = '2026-08-05T00:00:00.000Z';
const at = (min: number): string => new Date(Date.UTC(2026, 7, 5, 0, min)).toISOString();

/** Deterministic stand-in: the real citeproc is covered in citation-run.test.ts.
 *  Typed as `CitationFormatter` directly, not `as unknown as` — a future change
 *  to the interface (an added method, a renamed parameter) now fails this file
 *  at compile time instead of sliding past a cast. */
const formatter: CitationFormatter = {
  bibliography: (items, template) =>
    Promise.resolve(`[${template}] ${items.map((i) => i['id']).join('; ')}`),
  inText: (items, template) =>
    Promise.resolve(`(${template}:${items.map((i) => i['id']).join(',')})`),
  formatWithStyle: (items, style, kind) =>
    Promise.resolve(`[${style.id}:${kind}] ${items.map((i) => i['id']).join('; ')}`),
  compileStyle: (style) => Promise.resolve(`<style id="${style.id}"/>`),
  formatRun: (run) =>
    Promise.resolve({
      inText: run.order.map((id) => `(${id})`),
      bibliography: [...new Set(run.order)].map((id) => `BIB ${id}`).join('\n'),
    }),
};

let repos: RepositorySet;
let counter = 0;

const project: Project = {
  id: 'p1',
  name: 'Essay',
  members: [],
  createdAt: NOW,
  updatedAt: NOW,
  outline: [
    { id: 's1', title: 'Introduction' },
    { id: 's2', title: 'Evidence' },
  ],
  researchQuestion: 'Did subsidies increase adoption?',
};

function doc(id: string): Document {
  return {
    id,
    projectId: 'p1',
    url: `https://example.org/${id}`,
    type: 'article',
    metadata: { title: `Doc ${id}`, authors: ['Nowak, Anna'], year: 2016 },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
  };
}
function ref(id: string, documentId: string): Reference {
  return {
    id,
    projectId: 'p1',
    documentId,
    cslData: { title: `Doc ${documentId}` },
    source: 'extractedFromPage',
    usedInOutputs: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}
function anno(id: string, documentId: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id,
    projectId: 'p1',
    documentId,
    anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: `quote ${id}` }] },
    content: `note ${id}`,
    tags: [],
    status: 'draft',
    author: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`draft-${counter++}`));
  await repos.projects.put(project);
});

const compose = () =>
  composeDraft(repos, formatter, { projectId: 'p1', template: 'apa', flavour: 'text' });

describe('composeDraft', () => {
  it('groups passages under their section and leaves the rest unplaced', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));
    await repos.annotations.put(anno('a2', 'd1', { section: 's2' }));
    await repos.annotations.put(anno('a3', 'd1'));

    const draft = await compose();
    expect(draft.sections.map((s) => s.title)).toEqual(['Introduction', 'Evidence']);
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a3']);
    expect(draft.researchQuestion).toBe('Did subsidies increase adoption?');
  });

  it('orders passages within a section by when they were made', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('late', 'd1', { section: 's1', createdAt: at(30) }));
    await repos.annotations.put(anno('early', 'd1', { section: 's1', createdAt: at(10) }));

    const draft = await compose();
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['early', 'late']);
  });

  it('cites in section order, so the citation order follows the argument', async () => {
    await repos.documents.put(doc('d1'));
    await repos.documents.put(doc('d2'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.references.put(ref('r2', 'd2'));
    await repos.annotations.put(anno('a1', 'd2', { section: 's1' }));
    await repos.annotations.put(anno('a2', 'd1', { section: 's2' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.inTextFormatted).toBe('(r2)');
    expect(draft.sections[1]?.entries[0]?.inTextFormatted).toBe('(r1)');
  });

  it('takes the quote from the anchor', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.quote).toBe('quote a1');
    expect(draft.sections[0]?.entries[0]?.note).toBe('note a1');
  });

  it('keeps a dragged PDF region that has no quote, with its page', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(
      anno('a1', 'd1', {
        section: 's1',
        anchor: { kind: 'pdf', selectors: [{ type: 'pdfRegion', page: 4, rects: [] }] },
      }),
    );

    const draft = await compose();
    const entry = draft.sections[0]?.entries[0];
    expect(entry?.quote).toBeUndefined();
    expect(entry?.locator).toBe('PDF p. 4');
  });

  it('treats a stored empty-string quote as no quote at all', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(
      anno('a1', 'd1', {
        section: 's1',
        anchor: { kind: 'pdf', selectors: [{ type: 'pdfRegion', page: 4, rects: [], quote: '' }] },
      }),
    );

    const draft = await compose();
    const entry = draft.sections[0]?.entries[0];
    expect(entry?.quote).toBeUndefined();
    expect(entry && 'quote' in entry).toBe(false);
  });

  it('keeps a passage whose document has no reference, and counts it', async () => {
    await repos.documents.put(doc('d1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.missingReference).toBe(true);
    expect(draft.missingReferenceCount).toBe(1);
  });

  it('groups by colour when nothing has been assigned', async () => {
    await repos.projects.put({
      ...project,
      colorPalette: [
        { id: 'c1', swatch: '#ffcc00', label: 'Evidence' },
        { id: 'c2', swatch: '#ff0000', label: 'Disagree' },
      ],
    });
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { color: 'c1' }));
    await repos.annotations.put(anno('a2', 'd1', { color: 'c2' }));

    const draft = await compose();
    expect(draft.groupedByColour).toBe(true);
    expect(draft.sections.map((s) => s.title)).toEqual(['Evidence', 'Disagree']);
    expect(draft.unplaced).toEqual([]);
  });

  it('treats a section id that names no section as unplaced', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 'deleted-section' }));

    const draft = await compose();
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.groupedByColour).toBe(false);
  });

  it('does not let an empty-string section id place an annotation in both a bucket and unplaced', async () => {
    // An outline section with an empty-string id is a pathological input,
    // not one the UI produces — but the bucket predicate (`a.section ===
    // s.id`) and the old unplaced predicate (`!a.section`) disagreed on it:
    // both are satisfied by `section: ''`, which used to double the
    // annotation into a bucket AND `unplaced`. Since citations are now
    // looked up by annotation id, a duplicate would make one occurrence
    // silently take the other's citation.
    await repos.projects.put({
      ...project,
      outline: [
        { id: '', title: 'Untitled' },
        { id: 's2', title: 'Evidence' },
      ],
    });
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: '' }));

    const draft = await compose();
    const inSections = draft.sections.reduce(
      (n, s) => n + s.entries.filter((e) => e.annotationId === 'a1').length,
      0,
    );
    const inUnplaced = draft.unplaced.filter((e) => e.annotationId === 'a1').length;
    expect(inSections + inUnplaced).toBe(1);
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.unplaced).toEqual([]);
  });

  it('treats a colour that names no palette entry as unplaced, in colour-grouping mode', async () => {
    await repos.projects.put({
      ...project,
      colorPalette: [{ id: 'c1', swatch: '#ffcc00', label: 'Evidence' }],
    });
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { color: 'c1' }));
    await repos.annotations.put(anno('a2', 'd1', { color: 'deleted-colour' }));

    const draft = await compose();
    expect(draft.groupedByColour).toBe(true);
    expect(draft.sections.map((s) => s.title)).toEqual(['Evidence']);
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a2']);
  });

  it('returns an empty draft rather than throwing when there is nothing collected', async () => {
    const draft = await compose();
    expect(draft.sections.every((s) => s.entries.length === 0)).toBe(true);
    expect(draft.bibliography).toBe('');
  });

  it('does not claim colour grouping when nothing has a section or a colour (Ruling B)', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1'));

    const draft = await compose();
    expect(draft.groupedByColour).toBe(false);
    expect(draft.sections.map((s) => s.title)).toEqual(['Introduction', 'Evidence']);
    expect(draft.sections.every((s) => s.entries.length === 0)).toBe(true);
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a1']);
  });

  // This passes against the pre-Finding-3 shared-cursor implementation too —
  // it does not prove the `Map<Id, string>` lookup is *necessary*. What it
  // does pin: a passage with no matching Reference consumes no citation slot
  // (the missing one leaves `''`, not a shift), and crossing the
  // bucket→unplaced boundary does not itself misalign the citations that
  // follow. That is real coverage against a regression on either point; it
  // just isn't evidence that the cursor was ever actually unsafe.
  it('keeps citations aligned across a missing reference in the middle of a bucket (cursor invariant)', async () => {
    await repos.documents.put(doc('d1'));
    await repos.documents.put(doc('d2')); // deliberately no reference for d2
    await repos.documents.put(doc('d3'));
    await repos.documents.put(doc('d4'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.references.put(ref('r3', 'd3'));
    await repos.references.put(ref('r4', 'd4'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1', createdAt: at(10) }));
    await repos.annotations.put(anno('a2', 'd2', { section: 's1', createdAt: at(20) }));
    await repos.annotations.put(anno('a3', 'd3', { section: 's1', createdAt: at(30) }));
    await repos.annotations.put(anno('a4', 'd4', { createdAt: at(40) })); // unplaced

    const draft = await compose();
    expect(draft.sections[0]?.entries.map((e) => e.inTextFormatted)).toEqual(['(r1)', '', '(r3)']);
    expect(draft.unplaced[0]?.inTextFormatted).toBe('(r4)');
  });

  it('throws a named error when formatRun returns the wrong number of citations', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const brokenFormatter: CitationFormatter = {
      ...formatter,
      formatRun: () => Promise.resolve({ inText: [], bibliography: '' }),
    };

    await expect(
      composeDraft(repos, brokenFormatter, { projectId: 'p1', template: 'apa', flavour: 'text' }),
    ).rejects.toThrow(CitationRunLengthMismatchError);
  });

  it('reads quote and locator from any selector, not just the first, on a multi-selector PDF anchor', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(
      anno('a1', 'd1', {
        section: 's1',
        anchor: {
          kind: 'pdf',
          selectors: [
            { type: 'pdfRegion', page: 3, rects: [] },
            { type: 'pdfRegion', page: 4, rects: [], quote: 'the real quote' },
          ],
        },
      }),
    );

    const draft = await compose();
    const entry = draft.sections[0]?.entries[0];
    expect(entry?.quote).toBe('the real quote');
    expect(entry?.locator).toBe('PDF p. 3');
  });

  // Fix round 1, item 1: `draftToHtml`/`draftToMarkdown` (serialise.ts) each
  // require a matching `Draft.flavour`, and that field is only ever correct
  // if composeDraft actually sets it from its own request rather than, say,
  // a stale default.
  it('sets flavour from the compose request, not a fixed default', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const textDraft = await composeDraft(repos, formatter, {
      projectId: 'p1',
      template: 'apa',
      flavour: 'text',
    });
    expect(textDraft.flavour).toBe('text');

    const htmlDraft = await composeDraft(repos, formatter, {
      projectId: 'p1',
      template: 'apa',
      flavour: 'html',
    });
    expect(htmlDraft.flavour).toBe('html');
  });

  it('carries the colour label even when grouped by outline section', async () => {
    await repos.projects.put({
      ...project,
      colorPalette: [{ id: 'c1', swatch: '#ffcc00', label: 'Key evidence' }],
    });
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1', color: 'c1' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.colorLabel).toBe('Key evidence');
  });
});

describe('groupPassages', () => {
  // `groupPassages` now derives `outline`/`palette` from a `Project` itself
  // (Fix round 3, item 1) rather than taking them as separate parameters, so
  // these tests build a project literal the same way the `composeDraft`
  // tests above do, reusing the module-level `project`'s shape.
  const groupPassagesProject: Project = {
    ...project,
    outline: [
      { id: 's1', title: 'Introduction' },
      { id: 's2', title: 'Evidence' },
    ],
    colorPalette: [
      { id: 'c1', swatch: '#ffcc00', label: 'Key evidence' },
      { id: 'c2', swatch: '#ff0000', label: 'Disagree' },
    ],
  };

  it('buckets by outline section, oldest first, leaving the rest unplaced', () => {
    const annotations = [
      anno('a1', 'd1', { section: 's1', createdAt: at(30) }),
      anno('a2', 'd1', { section: 's1', createdAt: at(10) }),
      anno('a3', 'd1', { section: 's2' }),
      anno('a4', 'd1'),
    ];

    const grouped = groupPassages(annotations, groupPassagesProject);
    expect(grouped.buckets.map((b) => b.title)).toEqual(['Introduction', 'Evidence']);
    expect(grouped.buckets[0]?.items.map((a) => a.id)).toEqual(['a2', 'a1']);
    expect(grouped.buckets[1]?.items.map((a) => a.id)).toEqual(['a3']);
    expect(grouped.unplaced.map((a) => a.id)).toEqual(['a4']);
    expect(grouped.groupedByColour).toBe(false);
  });

  it('falls back to colour buckets only when the outline was never used and a colour bucket has entries', () => {
    const annotations = [anno('a1', 'd1', { color: 'c1' }), anno('a2', 'd1', { color: 'c2' })];

    const grouped = groupPassages(annotations, groupPassagesProject);
    expect(grouped.groupedByColour).toBe(true);
    expect(grouped.buckets.map((b) => b.title)).toEqual(['Key evidence', 'Disagree']);
    expect(grouped.unplaced).toEqual([]);
  });

  it('does not claim colour grouping when nothing has a section or a colour (Ruling B)', () => {
    const annotations = [anno('a1', 'd1'), anno('a2', 'd1')];

    const grouped = groupPassages(annotations, groupPassagesProject);
    expect(grouped.groupedByColour).toBe(false);
    expect(grouped.buckets.map((b) => b.title)).toEqual(['Introduction', 'Evidence']);
    expect(grouped.buckets.every((b) => b.items.length === 0)).toBe(true);
    expect(grouped.unplaced.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  // Fix round 2: in colour mode, a passage with a valid colour but no
  // section is accounted for by its colour bucket, so `unplaced` (what the
  // export means by the word) correctly excludes it. But the Outline screen
  // renders no colour buckets of its own — it exists to assign sections — so
  // reading `unplaced` there made this exact passage disappear from the page
  // entirely. `unsectioned` fixes that: it means "has no section", full stop,
  // regardless of grouping mode, so the passage stays visible here even while
  // `unplaced` (rightly) omits it.
  it('keeps a coloured unsectioned passage out of `unplaced` but visible in `unsectioned`, in colour-grouping mode', () => {
    const annotations = [anno('a1', 'd1', { color: 'c1' })];

    const grouped = groupPassages(annotations, groupPassagesProject);
    expect(grouped.groupedByColour).toBe(true);
    expect(grouped.unplaced.map((a) => a.id)).toEqual([]);
    expect(grouped.unsectioned.map((a) => a.id)).toEqual(['a1']);
  });
});
