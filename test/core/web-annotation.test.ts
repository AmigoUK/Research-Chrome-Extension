import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  annotateWebPage,
  findDocumentByUrl,
  resolveProjectId,
} from '../../src/core/usecases/web-annotation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { CaptureInput } from '../../src/core/usecases/capture';
import type { Project, WebAnchor } from '../../src/core/model/types';
import { DEFAULT_OUTLINE_TITLES } from '../../src/core/draft/outline';

let repos: RepositorySet;
let counter = 0;
let tick = 0;
const deps = {
  newId: () => `id-${++tick}`,
  now: () => new Date(Date.UTC(2026, 6, 26, 0, 0, ++tick)).toISOString(),
};

const input = (url: string): CaptureInput => ({
  projectId: 'p1',
  url,
  type: 'webPage',
  metadata: { title: 'A page' },
});
const anchor: WebAnchor = { kind: 'web', selectors: [{ type: 'textQuote', exact: 'passage' }] };

const project = (id: string, name = 'P1'): Project => ({
  id,
  name,
  sections: ['Literature', 'Methods', 'Data', 'Report'],
  members: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`web-anno-${counter++}`));
  tick = 0;
});

describe('annotateWebPage', () => {
  beforeEach(async () => {
    await repos.projects.put(project('p1'));
  });

  it('creates the document on first annotation, then reuses it by URL', async () => {
    const first = await annotateWebPage(repos, input('https://ex.org/a'), anchor, deps);
    expect(first.createdDocument).toBe(true);
    // No colour chosen → none stored (legacy annotations render the accent).
    expect(first.annotation.color).toBeUndefined();

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

describe('resolveProjectId / no-active-project fallback (spec: web-annotation design)', () => {
  it('seeds a default project when the store is empty and projectId is empty', async () => {
    expect(await repos.projects.list()).toHaveLength(0);

    const { document, annotation } = await annotateWebPage(
      repos,
      { ...input('https://ex.org/seed'), projectId: '' },
      anchor,
      deps,
    );

    const projects = await repos.projects.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('My Research');
    expect(projects[0]?.outline?.map((s) => s.title)).toEqual([...DEFAULT_OUTLINE_TITLES]);
    expect(document.projectId).toBe(projects[0]?.id);
    expect(document.projectId).not.toBe('');
    expect(annotation.projectId).toBe(projects[0]?.id);

    const docs = await repos.documents.listByProject(projects[0]!.id);
    expect(docs).toHaveLength(1);
  });

  it('reuses the first existing project when projectId is empty and a project already exists', async () => {
    await repos.projects.put(project('existing', 'Existing Project'));

    const { document } = await annotateWebPage(
      repos,
      { ...input('https://ex.org/reuse'), projectId: '' },
      anchor,
      deps,
    );

    expect(document.projectId).toBe('existing');
    expect(await repos.projects.list()).toHaveLength(1); // no seeding when one already exists
  });

  it('reuses the first existing project when the stored projectId no longer exists', async () => {
    await repos.projects.put(project('existing', 'Existing Project'));

    const { document } = await annotateWebPage(
      repos,
      { ...input('https://ex.org/stale'), projectId: 'stale-id-not-in-db' },
      anchor,
      deps,
    );

    expect(document.projectId).toBe('existing');
  });

  it('resolveProjectId returns the given id unchanged when that project exists', async () => {
    await repos.projects.put(project('p1'));
    expect(await resolveProjectId(repos, 'p1', deps)).toBe('p1');
  });
});

describe('highlight colours', () => {
  it('stores the chosen colour on the annotation', async () => {
    const { annotation } = await annotateWebPage(
      repos,
      input('https://ex.org/colored'),
      anchor,
      deps,
      'pink',
    );
    expect(annotation.color).toBe('pink');
    const stored = await repos.annotations.get(annotation.id);
    expect(stored?.color).toBe('pink');
  });
});
