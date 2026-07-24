import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { ActivityEvent, Document, Project, Reference } from '../../src/core/model/types';

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
      [
        'activity',
        'annotations',
        'commentThreads',
        'citationStyles',
        'documents',
        'files',
        'projects',
        'references',
        'users',
      ].sort(),
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

describe('activity repository', () => {
  function makeEvent(id: string, projectId: string, createdAt: string): ActivityEvent {
    return {
      id,
      projectId,
      actorUserId: 'me',
      kind: 'status',
      summary: `event ${id}`,
      createdAt,
    };
  }

  it('lists a project newest first, isolating other projects', async () => {
    await repos.activity.put(makeEvent('a1', 'p1', '2026-07-24T09:00:00.000Z'));
    await repos.activity.put(makeEvent('a2', 'p1', '2026-07-24T11:00:00.000Z'));
    await repos.activity.put(makeEvent('a3', 'p1', '2026-07-24T10:00:00.000Z'));
    await repos.activity.put(makeEvent('b1', 'p2', '2026-07-24T12:00:00.000Z'));

    expect((await repos.activity.listByProject('p1')).map((e) => e.id)).toEqual(['a2', 'a3', 'a1']);
    expect((await repos.activity.listByProject('p2')).map((e) => e.id)).toEqual(['b1']);
  });

  it('caps the read at `limit`, keeping the newest events', async () => {
    await repos.activity.put(makeEvent('a1', 'p1', '2026-07-24T09:00:00.000Z'));
    await repos.activity.put(makeEvent('a2', 'p1', '2026-07-24T10:00:00.000Z'));
    await repos.activity.put(makeEvent('a3', 'p1', '2026-07-24T11:00:00.000Z'));

    expect((await repos.activity.listByProject('p1', 2)).map((e) => e.id)).toEqual(['a3', 'a2']);
  });

  it('deletes an event', async () => {
    await repos.activity.put(makeEvent('a1', 'p1', '2026-07-24T09:00:00.000Z'));
    await repos.activity.delete('a1');
    expect(await repos.activity.listByProject('p1')).toEqual([]);
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
