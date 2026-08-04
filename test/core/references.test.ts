import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  cslToDocumentMetadata,
  enrichDocumentFromDoi,
  importReferenceByDoi,
  normaliseDoi,
  type ImportDeps,
} from '../../src/core/usecases/references';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Document } from '../../src/core/model/types';

let repos: RepositorySet;
let counter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`refs-${counter++}`));
});

function deps(csl: unknown): ImportDeps {
  let n = 0;
  return {
    fetchCsl: async () => csl,
    newId: () => `ref-${n++}`,
    now: () => '2026-07-23T00:00:00.000Z',
  };
}

const SAMPLE = {
  DOI: '10.1002/qj.49710845502',
  title: 'The energetic basis of the urban heat island',
  author: [{ family: 'Oke', given: 'T. R.' }],
  issued: { 'date-parts': [[1982]] },
  'container-title': 'Quarterly Journal of the Royal Meteorological Society',
  type: 'article-journal',
};

describe('normaliseDoi', () => {
  it('strips url and doi: prefixes', () => {
    expect(normaliseDoi('https://doi.org/10.1/x')).toBe('10.1/x');
    expect(normaliseDoi('http://dx.doi.org/10.1/x')).toBe('10.1/x');
    expect(normaliseDoi('doi:10.1/x')).toBe('10.1/x');
    expect(normaliseDoi('  10.1/x  ')).toBe('10.1/x');
  });
});

describe('importReferenceByDoi', () => {
  it('stores fetched CSL-JSON as a project reference', async () => {
    const ref = await importReferenceByDoi(
      repos,
      { projectId: 'p1', doi: 'https://doi.org/10.1002/qj.49710845502' },
      deps(SAMPLE),
    );
    expect(ref.projectId).toBe('p1');
    // A record fetched from doi.org is not hand-entered, and the References
    // view's ORIGIN column shows the difference.
    expect(ref.source).toBe('importedByDoi');
    expect((ref.cslData as { title?: string }).title).toBe(SAMPLE.title);

    const stored = await repos.references.listByProject('p1');
    expect(stored).toHaveLength(1);
  });

  it('accepts a CSL array and takes the first entry', async () => {
    const ref = await importReferenceByDoi(
      repos,
      { projectId: 'p1', doi: '10.1/x' },
      deps([SAMPLE]),
    );
    expect((ref.cslData as { title?: string }).title).toBe(SAMPLE.title);
  });

  it('backfills a missing DOI onto the stored data', async () => {
    const noDoi: Record<string, unknown> = { ...SAMPLE };
    delete noDoi.DOI;
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: '10.9/y' }, deps(noDoi));
    expect((ref.cslData as { DOI?: string }).DOI).toBe('10.9/y');
  });

  it('dedupes by DOI within a project', async () => {
    await importReferenceByDoi(
      repos,
      { projectId: 'p1', doi: '10.1002/qj.49710845502' },
      deps(SAMPLE),
    );
    await importReferenceByDoi(
      repos,
      { projectId: 'p1', doi: 'doi:10.1002/qj.49710845502' },
      deps(SAMPLE),
    );
    expect(await repos.references.listByProject('p1')).toHaveLength(1);
  });

  it('rejects an empty DOI', async () => {
    await expect(
      importReferenceByDoi(repos, { projectId: 'p1', doi: '   ' }, deps(SAMPLE)),
    ).rejects.toThrow();
  });
});

describe('cslToDocumentMetadata', () => {
  it('maps the registry record onto our metadata shape', () => {
    const meta = cslToDocumentMetadata({
      ...SAMPLE,
      volume: '108',
      issue: '455',
      page: '1-24',
      publisher: 'RMetS',
    });
    expect(meta).toEqual({
      title: 'The energetic basis of the urban heat island',
      authors: ['Oke, T. R.'],
      year: 1982,
      journal: 'Quarterly Journal of the Royal Meteorological Society',
      publisher: 'RMetS',
      volume: '108',
      issue: '455',
      pages: '1-24',
    });
  });

  it('keeps literal names and skips what the registry does not carry', () => {
    const meta = cslToDocumentMetadata({ author: [{ literal: 'Defra' }] });
    expect(meta).toEqual({ authors: ['Defra'] });
  });
});

describe('enrichDocumentFromDoi', () => {
  const captured: Document = {
    id: 'd1',
    projectId: 'p1',
    url: 'https://example.org/paper',
    type: 'webPage',
    // What a patchy publisher page yields: right DOI, thin everything else.
    metadata: { title: 'Page title', doi: '10.1002/qj.49710845502' },
    status: 'toRead',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };

  it('completes the document from the registry and links a full reference', async () => {
    await repos.documents.put(captured);
    const { document, reference } = await enrichDocumentFromDoi(repos, 'd1', deps(SAMPLE));
    expect(document.metadata.title).toBe('The energetic basis of the urban heat island');
    expect(document.metadata.authors).toEqual(['Oke, T. R.']);
    expect(document.metadata.year).toBe(1982);
    expect(document.type).toBe('article');
    expect(reference.documentId).toBe('d1');
    expect((reference.cslData as { title?: string }).title).toBe(SAMPLE.title);
    // Persisted, not just returned.
    expect((await repos.documents.get('d1'))?.metadata.year).toBe(1982);
  });

  it('keeps captured values the registry does not carry', async () => {
    await repos.documents.put({
      ...captured,
      metadata: { ...captured.metadata, publisher: 'Captured Publisher' },
    });
    const { document } = await enrichDocumentFromDoi(repos, 'd1', deps({ title: 'T' }));
    expect(document.metadata.publisher).toBe('Captured Publisher');
  });

  it('updates the existing reference with the same DOI instead of duplicating', async () => {
    await repos.documents.put(captured);
    await importReferenceByDoi(
      repos,
      { projectId: 'p1', doi: '10.1002/qj.49710845502' },
      deps(SAMPLE),
    );
    await enrichDocumentFromDoi(repos, 'd1', deps(SAMPLE));
    const refs = await repos.references.listByProject('p1');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.documentId).toBe('d1');
  });

  it('refuses a document with no DOI', async () => {
    await repos.documents.put({ ...captured, metadata: { title: 'No DOI here' } });
    await expect(enrichDocumentFromDoi(repos, 'd1', deps(SAMPLE))).rejects.toThrow(/no DOI/);
  });
});
