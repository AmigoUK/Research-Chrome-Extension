import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  documentLabel,
  listActivity,
  recordActivity,
  recordAnnotationDelete,
  recordAnnotationPut,
  recordDocumentPut,
  recordMemberRemoved,
  recordMemberRoleChanged,
  recordReferenceAdded,
  referenceLabel,
} from '../../src/core/usecases/activity';
import type { CaptureDeps } from '../../src/core/usecases/capture';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, Document, Reference } from '../../src/core/model/types';

const NOW = '2026-07-24T12:00:00.000Z';

let repos: RepositorySet;
let counter = 0;
let ids = 0;
const deps: CaptureDeps = { newId: () => `e${++ids}`, now: () => NOW };

function makeDocument(over: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    projectId: 'p1',
    url: 'https://example.org/paper',
    type: 'article',
    metadata: { title: 'Urban heat and mortality' },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeAnnotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    projectId: 'p1',
    documentId: 'd1',
    anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'quote' }] },
    content: 'note',
    tags: [],
    status: 'draft',
    author: 'me',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeReference(over: Partial<Reference> = {}): Reference {
  return {
    id: 'r1',
    projectId: 'p1',
    cslData: { title: 'Heat waves in cities', DOI: '10.1000/xyz' },
    source: 'extractedFromPage',
    usedInOutputs: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`activity-${counter++}`));
  ids = 0;
});

describe('recordActivity', () => {
  it('stamps the local user, an id and the clock', async () => {
    await recordActivity(repos, deps, { projectId: 'p1', kind: 'sync', summary: 'synced' });

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      id: 'e1',
      projectId: 'p1',
      actorUserId: 'me',
      kind: 'sync',
      summary: 'synced',
      createdAt: NOW,
    });
  });

  it('never throws when the write fails — the feed must not undo the change', async () => {
    const broken: RepositorySet = {
      ...repos,
      activity: {
        ...repos.activity,
        put: () => Promise.reject(new Error('quota exceeded')),
      },
    };

    await expect(
      recordActivity(broken, deps, { projectId: 'p1', kind: 'status', summary: 'moved' }),
    ).resolves.toBeUndefined();
  });
});

describe('document events', () => {
  it('records a new source on the first write', async () => {
    await recordDocumentPut(repos, deps, undefined, makeDocument());

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      kind: 'source',
      summary: 'added Urban heat and mortality',
      entityLabel: 'Urban heat and mortality',
      entityId: 'd1',
    });
    expect(event?.from).toBeUndefined();
  });

  it('records a status move with raw before→after values', async () => {
    const previous = makeDocument();
    await recordDocumentPut(repos, deps, previous, { ...previous, status: 'inReview' });

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      kind: 'status',
      summary: 'moved Urban heat and mortality',
      from: 'toRead',
      to: 'inReview',
    });
  });

  it('records nothing when only metadata changed', async () => {
    const previous = makeDocument();
    await recordDocumentPut(repos, deps, previous, {
      ...previous,
      metadata: { title: 'Urban heat and mortality (revised)' },
    });

    expect(await listActivity(repos, 'p1')).toEqual([]);
  });
});

describe('annotation events', () => {
  it('names the document a note was added on', async () => {
    await repos.documents.put(makeDocument());
    await recordAnnotationPut(repos, deps, undefined, makeAnnotation());

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      kind: 'annotation',
      summary: 'added an annotation on Urban heat and mortality',
      entityId: 'a1',
    });
  });

  it('records a review with before→after, and nothing when the note only changed text', async () => {
    await repos.documents.put(makeDocument());
    const previous = makeAnnotation();

    await recordAnnotationPut(repos, deps, previous, { ...previous, content: 'edited' });
    expect(await listActivity(repos, 'p1')).toEqual([]);

    await recordAnnotationPut(repos, deps, previous, { ...previous, status: 'accepted' });
    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({ kind: 'annotation', from: 'draft', to: 'accepted' });
  });

  it('records a deletion, falling back when the document is gone', async () => {
    await recordAnnotationDelete(repos, deps, makeAnnotation());

    const [event] = await listActivity(repos, 'p1');
    expect(event?.summary).toBe('removed an annotation on a source');
  });
});

describe('reference and member events', () => {
  it('names an imported reference by its CSL title', async () => {
    await recordReferenceAdded(repos, deps, makeReference(), 'imported');

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({ kind: 'reference', summary: 'imported Heat waves in cities' });
  });

  it('records a role change with the member name and raw roles', async () => {
    await repos.users.put({ id: 'u2', name: 'L. Reyes', rolesPerProject: {} });
    await recordMemberRoleChanged(repos, deps, {
      projectId: 'p1',
      userId: 'u2',
      from: 'editor',
      to: 'viewer',
    });

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      kind: 'member',
      summary: 'changed the role of L. Reyes',
      from: 'editor',
      to: 'viewer',
    });
  });

  it('records nothing when the role did not actually change', async () => {
    await recordMemberRoleChanged(repos, deps, {
      projectId: 'p1',
      userId: 'u2',
      from: 'viewer',
      to: 'viewer',
    });

    expect(await listActivity(repos, 'p1')).toEqual([]);
  });

  it('falls back to the user id when there is no user row', async () => {
    await recordMemberRemoved(repos, deps, { projectId: 'p1', userId: 'ghost' });

    const [event] = await listActivity(repos, 'p1');
    expect(event?.summary).toBe('removed ghost from the project');
  });
});

describe('labels', () => {
  it('falls back from title to host for a document', () => {
    expect(documentLabel(makeDocument())).toBe('Urban heat and mortality');
    expect(documentLabel(makeDocument({ metadata: {} }))).toBe('example.org');
  });

  it('falls back from CSL title to DOI for a reference', () => {
    expect(referenceLabel(makeReference())).toBe('Heat waves in cities');
    expect(referenceLabel(makeReference({ cslData: { DOI: '10.1000/xyz' } }))).toBe('10.1000/xyz');
    expect(referenceLabel(makeReference({ cslData: {} }))).toBe('a reference');
  });
});
