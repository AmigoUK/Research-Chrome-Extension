import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { composeDraft } from '../../src/core/usecases/draft';
import type { CitationFormatter, CitationRun } from '../../src/core/ports/citation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, Document, Project, Reference } from '../../src/core/model/types';

const NOW = '2026-08-05T00:00:00.000Z';
const at = (min: number): string => new Date(Date.UTC(2026, 7, 5, 0, min)).toISOString();

/** Deterministic stand-in: the real citeproc is covered in citation-run.test.ts. */
const formatter = {
  formatRun: (run: CitationRun) =>
    Promise.resolve({
      inText: run.order.map((id) => `(${id})`),
      bibliography: [...new Set(run.order)].map((id) => `BIB ${id}`).join('\n'),
    }),
} as unknown as CitationFormatter;

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

  it('returns an empty draft rather than throwing when there is nothing collected', async () => {
    const draft = await compose();
    expect(draft.sections.every((s) => s.entries.length === 0)).toBe(true);
    expect(draft.bibliography).toBe('');
  });
});
