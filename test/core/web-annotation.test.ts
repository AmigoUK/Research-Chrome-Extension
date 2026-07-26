import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { annotateWebPage, findDocumentByUrl } from '../../src/core/usecases/web-annotation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { CaptureInput } from '../../src/core/usecases/capture';
import type { WebAnchor } from '../../src/core/model/types';

let repos: RepositorySet;
let counter = 0;
let tick = 0;
const deps = { newId: () => `id-${++tick}`, now: () => new Date(Date.UTC(2026, 6, 26, 0, 0, ++tick)).toISOString() };

const input = (url: string): CaptureInput => ({
  projectId: 'p1',
  url,
  type: 'webPage',
  metadata: { title: 'A page' },
});
const anchor: WebAnchor = { kind: 'web', selectors: [{ type: 'textQuote', exact: 'passage' }] };

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`web-anno-${counter++}`));
  tick = 0;
});

describe('annotateWebPage', () => {
  it('creates the document on first annotation, then reuses it by URL', async () => {
    const first = await annotateWebPage(repos, input('https://ex.org/a'), anchor, deps);
    expect(first.createdDocument).toBe(true);

    const second = await annotateWebPage(repos, input('https://ex.org/a'), anchor, deps);
    expect(second.createdDocument).toBe(false);
    expect(second.document.id).toBe(first.document.id);

    const docs = await repos.documents.listByProject('p1');
    expect(docs).toHaveLength(1);
    const notes = await repos.annotations.listByDocument(first.document.id);
    expect(notes).toHaveLength(2);
    expect(notes[0]?.anchor.kind).toBe('web');
  });

  it('findDocumentByUrl returns undefined when nothing is filed', async () => {
    expect(await findDocumentByUrl(repos, 'p1', 'https://ex.org/none')).toBeUndefined();
  });
});
