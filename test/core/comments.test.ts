import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  deleteThread,
  listThreads,
  replyToThread,
  setThreadResolved,
  sortThreads,
  startThread,
} from '../../src/core/usecases/comments';
import { listActivity } from '../../src/core/usecases/activity';
import type { CaptureDeps } from '../../src/core/usecases/capture';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, CommentThread, Document } from '../../src/core/model/types';

const NOW = '2026-07-24T12:00:00.000Z';

let repos: RepositorySet;
let counter = 0;
let tick = 0;
// A monotonic clock, so `updatedAt` ordering in `sortThreads` is deterministic.
const deps: CaptureDeps = {
  newId: () => `id-${++tick}`,
  now: () => new Date(Date.UTC(2026, 6, 24, 12, 0, ++tick)).toISOString(),
};

const document: Document = {
  id: 'd1',
  projectId: 'p1',
  url: 'https://example.org/paper',
  type: 'article',
  metadata: { title: 'Urban heat and mortality' },
  status: 'toRead',
  createdAt: NOW,
  updatedAt: NOW,
};

const annotation: Annotation = {
  id: 'a1',
  projectId: 'p1',
  documentId: 'd1',
  anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'nocturnal UHI intensity' }] },
  content: 'Check the lag structure here',
  tags: [],
  status: 'draft',
  author: 'me',
  createdAt: NOW,
  updatedAt: NOW,
};

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`comments-${counter++}`));
  tick = 0;
  await repos.documents.put(document);
  await repos.annotations.put(annotation);
});

describe('startThread', () => {
  it('anchors a thread to an annotation, taking its document and quote', async () => {
    const thread = await startThread(repos, deps, {
      projectId: 'p1',
      annotationId: 'a1',
      anchorLabel: '“nocturnal UHI intensity”',
      body: 'Should we cite Gasparrini here?',
    });

    expect(thread).toMatchObject({
      projectId: 'p1',
      documentId: 'd1',
      annotationId: 'a1',
      anchorLabel: '“nocturnal UHI intensity”',
      quote: 'Check the lag structure here',
      resolved: false,
    });
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]).toMatchObject({
      authorId: 'me',
      body: 'Should we cite Gasparrini here?',
    });
  });

  it('records the start in the activity feed under the comment kind', async () => {
    await startThread(repos, deps, { projectId: 'p1', documentId: 'd1', body: 'First' });

    const [event] = await listActivity(repos, 'p1');
    expect(event).toMatchObject({
      kind: 'comment',
      summary: 'started a thread on Urban heat and mortality',
    });
  });

  it('refuses an empty first comment and an unknown annotation', async () => {
    await expect(startThread(repos, deps, { projectId: 'p1', body: '   ' })).rejects.toThrow(
      /cannot be empty/,
    );
    await expect(
      startThread(repos, deps, { projectId: 'p1', annotationId: 'ghost', body: 'hi' }),
    ).rejects.toThrow(/Annotation not found/);
  });

  it('falls back to a plain anchor label when there is nothing to derive one from', async () => {
    const thread = await startThread(repos, deps, { projectId: 'p1', body: 'Open question' });
    expect(thread.anchorLabel).toBe('Source');
  });
});

describe('replyToThread', () => {
  it('appends a comment, moves updatedAt and records the reply', async () => {
    const started = await startThread(repos, deps, {
      projectId: 'p1',
      documentId: 'd1',
      body: 'First',
    });
    const replied = await replyToThread(repos, deps, { threadId: started.id, body: 'Second' });

    expect(replied.comments.map((c) => c.body)).toEqual(['First', 'Second']);
    expect(replied.updatedAt > started.updatedAt).toBe(true);

    const events = await listActivity(repos, 'p1');
    expect(events[0]?.summary).toBe('replied on Urban heat and mortality');
    expect(events).toHaveLength(2);
  });

  it('rejects an empty reply and an unknown thread', async () => {
    const started = await startThread(repos, deps, { projectId: 'p1', body: 'First' });
    await expect(replyToThread(repos, deps, { threadId: started.id, body: '' })).rejects.toThrow(
      /cannot be empty/,
    );
    await expect(replyToThread(repos, deps, { threadId: 'ghost', body: 'x' })).rejects.toThrow(
      /Thread not found/,
    );
  });
});

describe('setThreadResolved', () => {
  it('resolves and reopens, recording each way round', async () => {
    const started = await startThread(repos, deps, {
      projectId: 'p1',
      documentId: 'd1',
      body: 'First',
    });

    const resolved = await setThreadResolved(repos, deps, {
      threadId: started.id,
      resolved: true,
    });
    expect(resolved.resolved).toBe(true);

    const reopened = await setThreadResolved(repos, deps, {
      threadId: started.id,
      resolved: false,
    });
    expect(reopened.resolved).toBe(false);

    const events = await listActivity(repos, 'p1');
    expect(events.map((e) => e.summary)).toEqual([
      'reopened a thread on Urban heat and mortality',
      'resolved a thread on Urban heat and mortality',
      'started a thread on Urban heat and mortality',
    ]);
  });

  it('records nothing when the thread is already in that state', async () => {
    const started = await startThread(repos, deps, { projectId: 'p1', body: 'First' });
    await setThreadResolved(repos, deps, { threadId: started.id, resolved: false });

    expect(await listActivity(repos, 'p1')).toHaveLength(1);
  });
});

describe('deleteThread', () => {
  it('removes the thread and records it', async () => {
    const started = await startThread(repos, deps, { projectId: 'p1', body: 'First' });
    await deleteThread(repos, deps, started.id);

    expect(await listThreads(repos, 'p1')).toEqual([]);
    const [event] = await listActivity(repos, 'p1');
    expect(event?.summary).toMatch(/^deleted a thread/);
  });
});

describe('sortThreads', () => {
  it('puts open threads first, newest first within each group', () => {
    const thread = (id: string, resolved: boolean, updatedAt: string): CommentThread => ({
      id,
      projectId: 'p1',
      anchorLabel: 'Source',
      resolved,
      comments: [],
      createdAt: NOW,
      updatedAt,
    });

    const sorted = sortThreads([
      thread('resolved-old', true, '2026-07-20T00:00:00.000Z'),
      thread('open-old', false, '2026-07-21T00:00:00.000Z'),
      thread('resolved-new', true, '2026-07-24T00:00:00.000Z'),
      thread('open-new', false, '2026-07-23T00:00:00.000Z'),
    ]);

    expect(sorted.map((t) => t.id)).toEqual([
      'open-new',
      'open-old',
      'resolved-new',
      'resolved-old',
    ]);
  });
});
