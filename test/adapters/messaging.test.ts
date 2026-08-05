import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  CLIENT_ID,
  mutatesData,
  registerMessageRouter,
  sendRequest,
  senderMayRequest,
} from '../../src/adapters/chrome/messaging';
import type { Document } from '../../src/core/model/types';

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

/** Every message that crossed the mock wire — lets tests assert broadcasts. */
let sentMessages: unknown[] = [];

/** Minimal in-memory chrome.runtime that connects sendMessage to a listener. */
function installChromeMock(): void {
  let listener: Listener | undefined;
  sentMessages = [];
  const runtime = {
    onMessage: {
      addListener(fn: Listener) {
        listener = fn;
      },
    },
    sendMessage(message: unknown): Promise<unknown> {
      sentMessages.push(message);
      // Control broadcasts have no responder in this harness; resolve them so
      // the worker's fire-and-forget send settles.
      if (message && typeof (message as { control?: unknown }).control === 'string') {
        return Promise.resolve(undefined);
      }
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

describe('control-message channel ownership', () => {
  /**
   * `annotator-control.ts` shares chrome.runtime.onMessage with the router.
   * Chrome invokes every listener and delivers only the first sendResponse
   * to the caller, so the router must never answer a `{control}` message —
   * doing so would race (and, being synchronous-ish, usually beat) the real
   * control handler's async chrome.tabs/permissions work. This mock models
   * the real multi-listener, first-response-wins semantics to prove it.
   */
  it('leaves messages carrying a string `control` field unanswered, so another listener can respond', async () => {
    const listeners: Listener[] = [];
    const runtime = {
      onMessage: {
        addListener(fn: Listener) {
          listeners.push(fn);
        },
      },
      sendMessage(message: unknown): Promise<unknown> {
        return new Promise((resolve) => {
          let responded = false;
          const respond = (response: unknown) => {
            if (!responded) {
              responded = true;
              resolve(response);
            }
          };
          for (const listener of listeners) listener(message, {}, respond);
        });
      },
    };
    globalThis.chrome = { runtime } as unknown as typeof chrome;

    const repos = createRepositories(await openContextNotesDB(`msg-control-${counter++}`));
    registerMessageRouter(() => Promise.resolve(repos));

    // Stand-in for annotator-control.ts's listener: the only one that should
    // ever answer a `{control}` message. It replies via setTimeout, not a
    // microtask, because the real handler awaits genuine browser I/O
    // (chrome.tabs.query / chrome.permissions.request) — unlike the router's
    // already-resolved `getRepos()` promise, which settles within a couple of
    // microtasks. Without the router's early-return guard, the router's faster
    // (but wrong) reply would win this race every time.
    listeners.push((message, _sender, sendResponse) => {
      if (message && typeof (message as { control?: unknown }).control === 'string') {
        setTimeout(() => sendResponse({ handledBy: 'control' }), 0);
      }
      return true;
    });

    const response = await runtime.sendMessage({ control: 'annotator/activate' });
    expect(response).toEqual({ handledBy: 'control' });
  });
});

describe('sender gating', () => {
  const EXT = 'chrome-extension://abc';

  it('lets extension pages issue anything and content scripts only the annotator pair', () => {
    expect(senderMayRequest('snapshot/import', { origin: EXT }, EXT)).toBe(true);
    expect(senderMayRequest('documents/delete', undefined, EXT)).toBe(true); // worker-internal
    expect(senderMayRequest('web/annotate', { origin: 'https://ex.org' }, EXT)).toBe(true);
    expect(senderMayRequest('web/annotationsForUrl', { origin: 'https://ex.org' }, EXT)).toBe(true);
    for (const type of ['documents/delete', 'snapshot/import', 'files/get', 'members/remove']) {
      expect(senderMayRequest(type, { origin: 'https://ex.org' }, EXT), type).toBe(false);
    }
  });

  it('refuses a privileged message from a web-page sender over the wire', async () => {
    // Re-register with a mock that lets the test choose the sender.
    let listener: Listener | undefined;
    globalThis.chrome = {
      runtime: {
        id: 'abc',
        onMessage: {
          addListener(fn: Listener) {
            listener = fn;
          },
        },
        sendMessage: () => Promise.resolve(undefined),
      },
    } as unknown as typeof chrome;
    const repos = createRepositories(await openContextNotesDB(`msg-sender-${counter++}`));
    registerMessageRouter(() => Promise.resolve(repos));

    const ask = (sender: unknown): Promise<unknown> =>
      new Promise((resolve) => listener!({ type: 'documents/delete', id: 'd1' }, sender, resolve));

    expect(await ask({ origin: 'https://opted-in.example' })).toEqual({
      ok: false,
      error: 'Not available from this context',
    });
    expect(await ask({ origin: 'chrome-extension://abc' })).toMatchObject({ ok: true });
  });
});

describe('data-changed broadcast', () => {
  const doc: Document = {
    id: 'bd1',
    projectId: 'p1',
    url: 'https://example.org/b',
    type: 'article',
    metadata: { title: 'Broadcast me' },
    status: 'toRead',
    createdAt: NOW,
    updatedAt: NOW,
  };

  const broadcasts = (): unknown[] =>
    sentMessages.filter((m) => (m as { control?: string })?.control === 'data/changed');

  it('announces a successful write so other surfaces can refresh', async () => {
    await sendRequest({ type: 'documents/put', document: doc });
    // The broadcast is fire-and-forget after sendResponse; give it a tick.
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcasts()).toHaveLength(1);
    expect((broadcasts()[0] as { changedBy?: string }).changedBy).toBe('documents/put');
  });

  it('stays silent for reads', async () => {
    await sendRequest({ type: 'documents/listByProject', projectId: 'p1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcasts()).toHaveLength(0);
  });

  it('stays silent for a failed write', async () => {
    await expect(sendRequest({ type: 'snapshot/import', content: 'not json' })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(broadcasts()).toHaveLength(0);
  });

  it('names the client that caused the change, so a surface can skip its own echo', async () => {
    // Without this, the side panel re-read and repainted itself on its OWN
    // note autosave: 13 DOM rebuilds per saved note, a scroll jump, and
    // keystrokes landing on a textarea that had just been replaced.
    await sendRequest({ type: 'documents/put', document: doc });
    await new Promise((r) => setTimeout(r, 0));
    const broadcast = broadcasts()[0] as { sourceClient?: string } | undefined;
    expect(broadcast?.sourceClient).toBe(CLIENT_ID);
    // And the request carried it in the first place.
    const sentPut = sentMessages.find((m) => (m as { type?: string })?.type === 'documents/put') as
      { __client?: string } | undefined;
    expect(sentPut?.__client).toBe(CLIENT_ID);
  });

  it('classifies the message families, not a hand-kept list', () => {
    for (const type of [
      'documents/put',
      'documents/delete',
      'annotations/put',
      'capture/page',
      'web/annotate',
      'snapshot/import',
      'references/importByDoi',
      'documents/enrichFromDoi',
      'members/invite',
      'comments/reply',
      'comments/setResolved',
    ]) {
      expect(mutatesData(type), type).toBe(true);
    }
    for (const type of [
      'ping',
      'projects/list',
      'documents/listByProject',
      'files/get',
      'snapshot/preview',
      'snapshot/export',
      'citations/bibliography',
    ]) {
      expect(mutatesData(type), type).toBe(false);
    }
  });
});
