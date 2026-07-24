import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { migrationVersionsToRun, DB_VERSION } from './schema';
import { openContextNotesDB } from './db';

describe('migrationVersionsToRun', () => {
  it('lists versions from a fresh (empty) database up to the target', () => {
    expect(migrationVersionsToRun(0, 1)).toEqual([1]);
    expect(migrationVersionsToRun(0, 3)).toEqual([1, 2, 3]);
  });

  it('lists only versions strictly greater than the current one', () => {
    expect(migrationVersionsToRun(2, 4)).toEqual([3, 4]);
  });

  it('returns nothing when already at the target version', () => {
    expect(migrationVersionsToRun(DB_VERSION, DB_VERSION)).toEqual([]);
  });
});

describe('schema at DB_VERSION', () => {
  it('creates every store, up to v3 activity and v4 comment threads', async () => {
    globalThis.indexedDB = new IDBFactory();
    const db = await openContextNotesDB('schema-v4');
    expect(db.version).toBe(DB_VERSION);
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
    db.close();
  });

  it('indexes activity by project and time, for newest-first reads', async () => {
    globalThis.indexedDB = new IDBFactory();
    const db = await openContextNotesDB('schema-v3-index');
    const index = db.transaction('activity').store.index('byProjectTime');
    expect(index.keyPath).toEqual(['projectId', 'createdAt']);
    db.close();
  });

  it('indexes comment threads by project and by document', async () => {
    globalThis.indexedDB = new IDBFactory();
    const db = await openContextNotesDB('schema-v4-index');
    const store = db.transaction('commentThreads').store;
    expect([...store.indexNames].sort()).toEqual(['byDocument', 'byProject']);
    db.close();
  });
});
