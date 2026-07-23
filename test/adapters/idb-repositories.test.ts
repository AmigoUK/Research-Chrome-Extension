import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Document, Project, Reference } from '../../src/core/model/types';

const NOW = '2026-07-23T00:00:00.000Z';

function makeProject(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    sections: ['Literature'],
    members: [{ userId: 'u1', role: 'owner' }],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeDocument(id: string, projectId: string, doi?: string): Document {
  return {
    id,
    projectId,
    url: `https://example.org/${id}`,
    type: 'article',
    metadata: doi ? { title: id, doi } : { title: id },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeReference(id: string, projectId: string, doi: string): Reference {
  return {
    id,
    projectId,
    cslData: { type: 'article-journal', DOI: doi, title: id },
    source: 'extractedFromPage',
    usedInOutputs: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

let repos: RepositorySet;
let dbCounter = 0;

beforeEach(async () => {
  // Fresh in-memory IndexedDB per test.
  globalThis.indexedDB = new IDBFactory();
  const db = await openContextNotesDB(`test-db-${dbCounter++}`);
  repos = createRepositories(db);
});

describe('schema migration (v0 → current)', () => {
  it('creates every object store on first open', async () => {
    const db = await openContextNotesDB(`stores-${dbCounter++}`);
    expect([...db.objectStoreNames].sort()).toEqual(
      ['annotations', 'citationStyles', 'documents', 'files', 'projects', 'references', 'users'].sort(),
    );
  });
});

describe('project repository CRUD', () => {
  it('puts, gets, lists, and deletes', async () => {
    await repos.projects.put(makeProject('p1'));
    expect((await repos.projects.get('p1'))?.name).toBe('Project p1');

    await repos.projects.put(makeProject('p2'));
    expect(await repos.projects.list()).toHaveLength(2);

    await repos.projects.delete('p1');
    expect(await repos.projects.get('p1')).toBeUndefined();
    expect(await repos.projects.list()).toHaveLength(1);
  });
});

describe('document repository', () => {
  it('lists by project, isolating other projects', async () => {
    await repos.documents.put(makeDocument('d1', 'p1'));
    await repos.documents.put(makeDocument('d2', 'p1'));
    await repos.documents.put(makeDocument('d3', 'p2'));

    expect(await repos.documents.listByProject('p1')).toHaveLength(2);
    expect(await repos.documents.listByProject('p2')).toHaveLength(1);
  });

  it('finds a document by DOI within a project (dedup on capture)', async () => {
    await repos.documents.put(makeDocument('d1', 'p1', '10.1000/xyz'));
    await repos.documents.put(makeDocument('d2', 'p2', '10.1000/xyz'));

    const hit = await repos.documents.findByDoi('p1', '10.1000/xyz');
    expect(hit?.id).toBe('d1');

    expect(await repos.documents.findByDoi('p1', '10.9999/none')).toBeUndefined();
  });
});

describe('reference repository DOI dedup', () => {
  it('matches DOIs regardless of case and doi.org prefix', async () => {
    await repos.references.put(makeReference('r1', 'p1', '10.1000/ABC'));

    expect((await repos.references.findByDoi('p1', '10.1000/abc'))?.id).toBe('r1');
    expect((await repos.references.findByDoi('p1', 'https://doi.org/10.1000/abc'))?.id).toBe('r1');
    expect(await repos.references.findByDoi('p2', '10.1000/abc')).toBeUndefined();
  });
});
