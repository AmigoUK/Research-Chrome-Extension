import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { registerMessageRouter, sendRequest } from '../../src/adapters/chrome/messaging';
import type { Document } from '../../src/core/model/types';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

/** Minimal in-memory chrome.runtime that connects sendMessage to a listener. */
function installChromeMock(): void {
  let listener: Listener | undefined;
  const runtime = {
    onMessage: {
      addListener(fn: Listener) {
        listener = fn;
      },
    },
    sendMessage(message: unknown): Promise<unknown> {
      return new Promise((resolve) => {
        if (!listener) throw new Error('no listener registered');
        listener(message, {}, resolve);
      });
    },
  };
  globalThis.chrome = { runtime } as unknown as typeof chrome;
}

const NOW = '2026-07-23T00:00:00.000Z';
let counter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  installChromeMock();
  const repos = createRepositories(await openContextNotesDB(`msg-${counter++}`));
  registerMessageRouter(() => Promise.resolve(repos));
});

describe('messaging round trip (client → worker → router)', () => {
  it('pings', async () => {
    expect(await sendRequest({ type: 'ping' })).toBe('pong');
  });

  it('files a document and reads it back over the wire', async () => {
    const doc: Document = {
      id: 'd1',
      projectId: 'p1',
      url: 'https://example.org/d1',
      type: 'article',
      metadata: { title: 'Test', doi: '10.1/x' },
      status: 'toRead',
      createdAt: NOW,
      updatedAt: NOW,
    };

    await sendRequest({ type: 'documents/put', document: doc });

    const read = await sendRequest({ type: 'documents/get', id: 'd1' });
    expect(read?.metadata.doi).toBe('10.1/x');

    const list = await sendRequest({ type: 'documents/listByProject', projectId: 'p1' });
    expect(list).toHaveLength(1);
  });

  it('rejects with the error message when a handler fails', async () => {
    await expect(sendRequest({ type: 'nope' } as unknown as never)).rejects.toThrow();
  });
});
