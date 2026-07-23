import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { handleRequest } from '../../src/core/router';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Document } from '../../src/core/model/types';

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

  it('lists citation styles', async () => {
    await repos.citationStyles.put({
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
    });
    const res = await handleRequest(repos, { type: 'citationStyles/list' });
    expect(res.ok && Array.isArray(res.data) && res.data).toHaveLength(1);
  });

  it('reports an error result for unknown message types', async () => {
    // Cast through unknown to simulate a malformed message off the wire.
    const res = await handleRequest(repos, { type: 'nope' } as unknown as never);
    expect(res.ok).toBe(false);
  });
});
