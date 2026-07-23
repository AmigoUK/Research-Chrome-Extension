import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { importReferenceByDoi, normaliseDoi, type ImportDeps } from '../../src/core/usecases/references';
import type { RepositorySet } from '../../src/core/ports/repositories';

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
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: 'https://doi.org/10.1002/qj.49710845502' }, deps(SAMPLE));
    expect(ref.projectId).toBe('p1');
    expect(ref.source).toBe('manual');
    expect((ref.cslData as { title?: string }).title).toBe(SAMPLE.title);

    const stored = await repos.references.listByProject('p1');
    expect(stored).toHaveLength(1);
  });

  it('accepts a CSL array and takes the first entry', async () => {
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: '10.1/x' }, deps([SAMPLE]));
    expect((ref.cslData as { title?: string }).title).toBe(SAMPLE.title);
  });

  it('backfills a missing DOI onto the stored data', async () => {
    const noDoi: Record<string, unknown> = { ...SAMPLE };
    delete noDoi.DOI;
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: '10.9/y' }, deps(noDoi));
    expect((ref.cslData as { DOI?: string }).DOI).toBe('10.9/y');
  });

  it('dedupes by DOI within a project', async () => {
    await importReferenceByDoi(repos, { projectId: 'p1', doi: '10.1002/qj.49710845502' }, deps(SAMPLE));
    await importReferenceByDoi(repos, { projectId: 'p1', doi: 'doi:10.1002/qj.49710845502' }, deps(SAMPLE));
    expect(await repos.references.listByProject('p1')).toHaveLength(1);
  });

  it('rejects an empty DOI', async () => {
    await expect(importReferenceByDoi(repos, { projectId: 'p1', doi: '   ' }, deps(SAMPLE))).rejects.toThrow();
  });
});
