import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { handleRequest } from '../../src/core/router';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { ActivityEvent, Document } from '../../src/core/model/types';

const NOW = '2026-07-23T00:00:00.000Z';

function makeDocument(id: string, projectId: string): Document {
  return {
    id,
    projectId,
    url: `https://example.org/${id}`,
    type: 'article',
    metadata: { title: id },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

let repos: RepositorySet;
let counter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`router-${counter++}`));
});

describe('handleRequest', () => {
  it('answers ping', async () => {
    expect(await handleRequest(repos, { type: 'ping' })).toEqual({ ok: true, data: 'pong' });
  });

  it('puts and reads a document (write→read round trip)', async () => {
    const putRes = await handleRequest(repos, {
      type: 'documents/put',
      document: makeDocument('d1', 'p1'),
    });
    expect(putRes).toEqual({ ok: true, data: null });

    const getRes = await handleRequest(repos, { type: 'documents/get', id: 'd1' });
    expect(getRes.ok).toBe(true);
    expect(getRes.ok && (getRes.data as Document).url).toBe('https://example.org/d1');

    const listRes = await handleRequest(repos, {
      type: 'documents/listByProject',
      projectId: 'p1',
    });
    expect(listRes.ok && (listRes.data as Document[])).toHaveLength(1);
  });

  it('puts and lists annotations by project', async () => {
    const now = NOW;
    const putRes = await handleRequest(repos, {
      type: 'annotations/put',
      annotation: {
        id: 'an1',
        projectId: 'p1',
        documentId: 'd1',
        anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'note' }] },
        content: 'note',
        tags: [],
        status: 'draft',
        author: 'me',
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(putRes).toEqual({ ok: true, data: null });
    const res = await handleRequest(repos, { type: 'annotations/listByProject', projectId: 'p1' });
    expect(res.ok && Array.isArray(res.data) && res.data).toHaveLength(1);
  });

  it('puts and lists references by project', async () => {
    const now = NOW;
    const putRes = await handleRequest(repos, {
      type: 'references/put',
      reference: {
        id: 'r1',
        projectId: 'p1',
        cslData: { DOI: '10.1/x', title: 'A reference' },
        source: 'manual',
        usedInOutputs: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(putRes).toEqual({ ok: true, data: null });

    const listRes = await handleRequest(repos, { type: 'references/listByProject', projectId: 'p1' });
    expect(listRes.ok && Array.isArray(listRes.data) && listRes.data).toHaveLength(1);
  });

  it('puts and lists citation styles', async () => {
    const putRes = await handleRequest(repos, {
      type: 'citationStyles/put',
      style: {
        id: 'apa',
        name: 'APA 7th',
        baseStyleId: 'apa',
        userRules: {
          system: 'authorDate',
          maxAuthors: 3,
          etAlUseFirst: 1,
          nameAnd: 'symbol',
          includeDoi: true,
          doiAsUri: true,
          includeUrl: false,
          includeIssue: true,
          pagePrefix: false,
          foiTemplate: false,
          legalTemplate: false,
        },
      },
    });
    expect(putRes).toEqual({ ok: true, data: null });
    const res = await handleRequest(repos, { type: 'citationStyles/list' });
    expect(res.ok && Array.isArray(res.data) && res.data).toHaveLength(1);
  });

  it('puts, lists by document, and deletes annotations', async () => {
    const now = NOW;
    const annotation = {
      id: 'an-doc',
      projectId: 'p1',
      documentId: 'doc-9',
      anchor: { kind: 'web' as const, selectors: [{ type: 'textQuote' as const, exact: 'x' }] },
      content: 'note',
      tags: [],
      status: 'draft' as const,
      author: 'me',
      createdAt: now,
      updatedAt: now,
    };
    await handleRequest(repos, { type: 'annotations/put', annotation });
    const listed = await handleRequest(repos, {
      type: 'annotations/listByDocument',
      documentId: 'doc-9',
    });
    expect(listed.ok && Array.isArray(listed.data) && listed.data).toHaveLength(1);

    const del = await handleRequest(repos, { type: 'annotations/delete', id: 'an-doc' });
    expect(del).toEqual({ ok: true, data: null });
    const after = await handleRequest(repos, {
      type: 'annotations/listByDocument',
      documentId: 'doc-9',
    });
    expect(after.ok && Array.isArray(after.data) && after.data).toHaveLength(0);
  });

  it('stores and reads back file bytes as base64 (write→read round trip)', async () => {
    // "%PDF-1.7" → base64
    const dataBase64 = 'JVBERi0xLjc=';
    const putRes = await handleRequest(repos, {
      type: 'files/put',
      file: { id: 'f1', name: 'paper.pdf', mime: 'application/pdf', dataBase64 },
    });
    expect(putRes).toEqual({ ok: true, data: null });

    const getRes = await handleRequest(repos, { type: 'files/get', id: 'f1' });
    expect(getRes.ok).toBe(true);
    const file = getRes.ok ? (getRes.data as { name: string; dataBase64: string }) : null;
    expect(file?.name).toBe('paper.pdf');
    expect(file?.dataBase64).toBe(dataBase64);

    const missing = await handleRequest(repos, { type: 'files/get', id: 'nope' });
    expect(missing).toEqual({ ok: true, data: undefined });
  });

  it('reports an error result for unknown message types', async () => {
    // Cast through unknown to simulate a malformed message off the wire.
    const res = await handleRequest(repos, { type: 'nope' } as unknown as never);
    expect(res.ok).toBe(false);
  });
});

describe('activity recording (Phase 5, M2)', () => {
  // A monotonic clock: events written in the same millisecond would tie in the
  // `[projectId, createdAt]` index and make the newest-first order arbitrary.
  let tick = 0;
  const deps = {
    capture: {
      newId: () => `id-${++tick}`,
      now: () => new Date(Date.UTC(2026, 6, 24, 12, 0, ++tick)).toISOString(),
    },
  };

  beforeEach(() => {
    tick = 0;
  });

  async function feed(projectId = 'p1', limit?: number): Promise<ActivityEvent[]> {
    const res = await handleRequest(
      repos,
      { type: 'activity/listByProject', projectId, ...(limit === undefined ? {} : { limit }) },
      deps,
    );
    return res.ok ? (res.data as ActivityEvent[]) : [];
  }

  it('records a new source once, then only the status move', async () => {
    const document = makeDocument('d1', 'p1');
    await handleRequest(repos, { type: 'documents/put', document }, deps);
    await handleRequest(
      repos,
      { type: 'documents/put', document: { ...document, status: 'inReview' } },
      deps,
    );
    // A metadata-only edit is not news and must not add a third event.
    await handleRequest(
      repos,
      {
        type: 'documents/put',
        document: { ...document, status: 'inReview', metadata: { title: 'Renamed' } },
      },
      deps,
    );

    const events = await feed();
    expect(events.map((e) => e.kind)).toEqual(['status', 'source']);
    expect(events[0]).toMatchObject({ from: 'toRead', to: 'inReview', entityId: 'd1' });
  });

  it('records annotations added, reviewed and removed', async () => {
    const annotation = {
      id: 'an1',
      projectId: 'p1',
      documentId: 'd1',
      anchor: { kind: 'web' as const, selectors: [{ type: 'textQuote' as const, exact: 'x' }] },
      content: 'note',
      tags: [],
      status: 'draft' as const,
      author: 'me',
      createdAt: NOW,
      updatedAt: NOW,
    };
    await handleRequest(repos, { type: 'annotations/put', annotation }, deps);
    await handleRequest(
      repos,
      { type: 'annotations/put', annotation: { ...annotation, status: 'accepted' } },
      deps,
    );
    await handleRequest(repos, { type: 'annotations/delete', id: 'an1' }, deps);

    const events = await feed();
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.kind === 'annotation')).toBe(true);
    expect(events[0]?.summary).toMatch(/^removed an annotation/);
    expect(events[1]).toMatchObject({ from: 'draft', to: 'accepted' });
  });

  it('records a member role change with the previous role', async () => {
    await repos.projects.put({
      id: 'p1',
      name: 'Urban Heat',
      sections: [],
      members: [
        { userId: 'me', role: 'owner' },
        { userId: 'u2', role: 'editor' },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    });
    await repos.users.put({ id: 'u2', name: 'L. Reyes', rolesPerProject: { p1: 'editor' } });

    await handleRequest(
      repos,
      { type: 'members/setRole', projectId: 'p1', userId: 'u2', role: 'viewer' },
      deps,
    );

    const events = await feed();
    expect(events[0]).toMatchObject({
      kind: 'member',
      summary: 'changed the role of L. Reyes',
      from: 'editor',
      to: 'viewer',
    });
  });

  it('records a capture once and stays silent when it dedupes', async () => {
    const input = {
      projectId: 'p1',
      url: 'https://example.org/heat',
      type: 'article' as const,
      metadata: { title: 'Urban heat', doi: '10.1000/heat' },
    };
    await handleRequest(repos, { type: 'capture/page', input }, deps);
    await handleRequest(repos, { type: 'capture/page', input }, deps);

    const events = await feed();
    expect(events.map((e) => e.kind)).toEqual(['source']);
    expect(events[0]?.summary).toBe('added Urban heat');
  });

  it('lists a project newest first and honours the limit', async () => {
    for (const id of ['d1', 'd2', 'd3']) {
      await handleRequest(repos, { type: 'documents/put', document: makeDocument(id, 'p1') }, deps);
    }
    await handleRequest(repos, { type: 'documents/put', document: makeDocument('d4', 'p2') }, deps);

    expect(await feed('p1')).toHaveLength(3);
    expect(await feed('p1', 2)).toHaveLength(2);
    expect(await feed('p2')).toHaveLength(1);
  });
});
