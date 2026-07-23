import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { capturePage, type CaptureDeps, type CaptureInput } from '../../src/core/usecases/capture';
import type { RepositorySet } from '../../src/core/ports/repositories';

let repos: RepositorySet;
let counter = 0;
let idSeq = 0;

const deps: CaptureDeps = {
  newId: () => `id-${idSeq++}`,
  now: () => '2026-07-23T00:00:00.000Z',
};

function input(doi?: string): CaptureInput {
  return {
    projectId: 'p1',
    url: 'https://example.org/paper',
    type: 'article',
    metadata: { title: 'Paper', ...(doi ? { doi } : {}) },
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  idSeq = 0;
  repos = createRepositories(await openContextNotesDB(`capture-${counter++}`));
});

describe('capturePage', () => {
  it('creates a document and a linked reference on first capture', async () => {
    const result = await capturePage(repos, input('10.1/x'), deps);

    expect(result.deduped).toBe(false);
    expect(result.reference.documentId).toBe(result.document.id);
    expect(result.reference.source).toBe('extractedFromPage');
    expect(await repos.documents.listByProject('p1')).toHaveLength(1);
    expect(result.reference.cslData['DOI']).toBe('10.1/x');
  });

  it('deduplicates by DOI on re-capture, reusing the existing document', async () => {
    const first = await capturePage(repos, input('10.1/x'), deps);
    const second = await capturePage(repos, input('10.1/x'), deps);

    expect(second.deduped).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(await repos.documents.listByProject('p1')).toHaveLength(1);
  });

  it('creates separate documents when there is no DOI', async () => {
    await capturePage(repos, input(), deps);
    await capturePage(repos, input(), deps);
    expect(await repos.documents.listByProject('p1')).toHaveLength(2);
  });
});
