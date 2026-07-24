import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  buildSnapshot,
  mergeSnapshot,
  previewMerge,
  type SnapshotData,
} from '../../src/core/usecases/snapshot';
import { listActivity } from '../../src/core/usecases/activity';
import { startThread } from '../../src/core/usecases/comments';
import type { CaptureDeps } from '../../src/core/usecases/capture';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, Document, Project, Reference } from '../../src/core/model/types';

const NOW = '2026-07-24T12:00:00.000Z';
const LATER = '2026-07-25T12:00:00.000Z';

let repos: RepositorySet;
let counter = 0;
let tick = 0;
const deps: CaptureDeps = {
  newId: () => `id-${++tick}`,
  now: () => new Date(Date.UTC(2026, 6, 26, 12, 0, ++tick)).toISOString(),
};

const project: Project = {
  id: 'p1',
  name: 'Urban Heat',
  sections: ['Literature'],
  members: [{ userId: 'me', role: 'owner' }],
  createdAt: NOW,
  updatedAt: NOW,
};

function makeDocument(over: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    projectId: 'p1',
    url: 'https://example.org/paper',
    type: 'article',
    metadata: { title: 'Urban heat and mortality', doi: '10.1000/heat' },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeReference(over: Partial<Reference> = {}): Reference {
  return {
    id: 'r1',
    projectId: 'p1',
    documentId: 'd1',
    cslData: { title: 'Urban heat and mortality', DOI: '10.1000/heat' },
    source: 'extractedFromPage',
    usedInOutputs: [],
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
    anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'heat' }] },
    content: 'Worth checking',
    tags: [],
    status: 'draft',
    author: 'me',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** A second, empty database standing in for another machine. */
async function otherMachine(): Promise<RepositorySet> {
  return createRepositories(await openContextNotesDB(`snapshot-other-${counter++}`));
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`snapshot-${counter++}`));
  tick = 0;
  await repos.projects.put(project);
  await repos.users.put({ id: 'me', name: 'You', rolesPerProject: { p1: 'owner' } });
  await repos.documents.put(makeDocument());
  await repos.references.put(makeReference());
  await repos.annotations.put(makeAnnotation());
});

describe('buildSnapshot', () => {
  it('collects the whole project, and leaves PDF bytes out by default', async () => {
    await repos.files.put({
      id: 'f1',
      name: 'paper.pdf',
      mime: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.7').buffer,
      createdAt: NOW,
    });
    await repos.documents.put(makeDocument({ fileId: 'f1' }));
    await startThread(repos, deps, { projectId: 'p1', documentId: 'd1', body: 'A question' });

    const data = await buildSnapshot(repos, 'p1');
    expect(data.project.name).toBe('Urban Heat');
    expect(data.documents).toHaveLength(1);
    expect(data.annotations).toHaveLength(1);
    expect(data.references).toHaveLength(1);
    expect(data.commentThreads).toHaveLength(1);
    expect(data.activity.length).toBeGreaterThan(0);
    expect(data.files).toBeUndefined();
  });

  it('includes PDF bytes when asked, as base64', async () => {
    await repos.files.put({
      id: 'f1',
      name: 'paper.pdf',
      mime: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.7').buffer,
      createdAt: NOW,
    });
    await repos.documents.put(makeDocument({ fileId: 'f1' }));

    const data = await buildSnapshot(repos, 'p1', { includeFiles: true });
    expect(data.files).toHaveLength(1);
    expect(data.files?.[0]).toMatchObject({ id: 'f1', name: 'paper.pdf' });
    expect(atob(data.files?.[0]?.dataBase64 ?? '')).toBe('%PDF-1.7');
  });

  it('refuses to snapshot a project that is not there', async () => {
    await expect(buildSnapshot(repos, 'ghost')).rejects.toThrow(/Project not found/);
  });
});

describe('mergeSnapshot onto another machine', () => {
  it('recreates the project whole, including files when they travelled', async () => {
    await repos.files.put({
      id: 'f1',
      name: 'paper.pdf',
      mime: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-1.7').buffer,
      createdAt: NOW,
    });
    await repos.documents.put(makeDocument({ fileId: 'f1' }));
    const data = await buildSnapshot(repos, 'p1', { includeFiles: true });

    const target = await otherMachine();
    const report = await mergeSnapshot(target, deps, data);

    expect(report).toMatchObject({ projectName: 'Urban Heat', documents: 1, annotations: 1, files: 1 });
    expect((await target.projects.get('p1'))?.name).toBe('Urban Heat');
    expect(await target.documents.listByProject('p1')).toHaveLength(1);
    expect(await target.files.get('f1')).toBeDefined();
  });

  it('is idempotent — importing the same file twice changes nothing', async () => {
    const data = await buildSnapshot(repos, 'p1');
    const target = await otherMachine();

    await mergeSnapshot(target, deps, data);
    const second = await mergeSnapshot(target, deps, data);

    expect(await target.documents.listByProject('p1')).toHaveLength(1);
    expect(await target.annotations.listByProject('p1')).toHaveLength(1);
    expect(second.documents).toBe(0);
    expect(second.skippedOlder).toBeGreaterThan(0);
  });
});

describe('merge rules', () => {
  it('dedups a source and a reference by DOI, and remaps what pointed at them', async () => {
    const data = await buildSnapshot(repos, 'p1');

    // The other machine already has the same paper under different ids.
    const target = await otherMachine();
    await target.projects.put(project);
    await target.documents.put(makeDocument({ id: 'local-doc' }));
    await target.references.put(makeReference({ id: 'local-ref', documentId: 'local-doc' }));

    const report = await mergeSnapshot(target, deps, data);

    expect(report.dedupedByDoi).toBe(2);
    expect(await target.documents.listByProject('p1')).toHaveLength(1);
    expect(await target.references.listByProject('p1')).toHaveLength(1);
    // The incoming annotation followed the DOI to the copy that was already here.
    const [annotation] = await target.annotations.listByProject('p1');
    expect(annotation?.documentId).toBe('local-doc');
  });

  it('keeps the newer record on both sides', async () => {
    await repos.annotations.put(makeAnnotation({ content: 'Newer note', updatedAt: LATER }));
    const data = await buildSnapshot(repos, 'p1');

    const target = await otherMachine();
    await target.projects.put(project);
    await target.annotations.put(makeAnnotation({ content: 'Older note' }));
    await mergeSnapshot(target, deps, data);
    expect((await target.annotations.get('a1'))?.content).toBe('Newer note');

    // …and the other way round: a newer local note survives the import.
    const target2 = await otherMachine();
    await target2.projects.put(project);
    await target2.annotations.put(
      makeAnnotation({ content: 'Local wins', updatedAt: '2026-07-26T12:00:00.000Z' }),
    );
    await mergeSnapshot(target2, deps, data);
    expect((await target2.annotations.get('a1'))?.content).toBe('Local wins');
  });

  it('unions project members rather than replacing them', async () => {
    const data = await buildSnapshot(repos, 'p1');

    const target = await otherMachine();
    await target.projects.put({
      ...project,
      members: [
        { userId: 'me', role: 'owner' },
        { userId: 'u2', role: 'editor' },
      ],
    });
    await mergeSnapshot(target, deps, data);

    const merged = await target.projects.get('p1');
    expect(merged?.members.map((m) => m.userId).sort()).toEqual(['me', 'u2']);
  });

  it('previews a merge without writing anything', async () => {
    const data = await buildSnapshot(repos, 'p1');
    const target = await otherMachine();

    const preview = await previewMerge(target, data);
    expect(preview).toMatchObject({ newProject: true, documents: 1, annotations: 1, references: 1 });

    // Nothing landed — a preview that wrote would be a lie.
    expect(await target.projects.list()).toHaveLength(0);
    expect(await target.documents.listByProject('p1')).toHaveLength(0);
    expect(await target.activity.listByProject('p1')).toHaveLength(0);
  });

  it('promises exactly what the import then does', async () => {
    await repos.documents.put(makeDocument({ id: 'd2', metadata: { title: 'Second' } }));
    const data = await buildSnapshot(repos, 'p1');

    const target = await otherMachine();
    await target.projects.put(project);
    await target.documents.put(makeDocument({ id: 'local-doc' }));

    const preview = await previewMerge(target, data);
    const actual = await mergeSnapshot(target, deps, data);

    expect(actual).toEqual(preview);
  });

  it('marks a project the machine already has as a merge, not a creation', async () => {
    const data = await buildSnapshot(repos, 'p1');
    const target = await otherMachine();
    await target.projects.put(project);

    expect((await previewMerge(target, data)).newProject).toBe(false);
  });

  it('shows an all-zero plan for a snapshot that is already here', async () => {
    const data = await buildSnapshot(repos, 'p1');
    const target = await otherMachine();
    await mergeSnapshot(target, deps, data);

    const preview = await previewMerge(target, data);
    expect(preview).toMatchObject({ documents: 0, annotations: 0, references: 0, newProject: false });
    expect(preview.skippedOlder).toBeGreaterThan(0);
  });

  it('records the import as a sync event', async () => {
    const data = await buildSnapshot(repos, 'p1');
    const target = await otherMachine();
    await mergeSnapshot(target, deps, data);

    const [event] = await listActivity(target, 'p1');
    expect(event).toMatchObject({ kind: 'sync', summary: 'imported a snapshot of Urban Heat' });
  });

  it('rejects a payload that is not a snapshot before writing anything', async () => {
    const target = await otherMachine();
    await expect(
      mergeSnapshot(target, deps, { documents: [] } as unknown as SnapshotData),
    ).rejects.toThrow(/the project is not a record/);
    await expect(
      mergeSnapshot(target, deps, { project, documents: 'nope' } as unknown as SnapshotData),
    ).rejects.toThrow(/the document list is not a list/);
    expect(await target.projects.list()).toHaveLength(0);
  });
});
