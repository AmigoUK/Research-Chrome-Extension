import { describe, it, expect, beforeEach } from 'vitest';
import { sameDocumentUrl, setPendingJump, takePendingJump } from './pending-jump';

/** Minimal chrome.storage.local over a Map. */
function installStorage(): { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          const value = store.get(key);
          return value === undefined ? {} : { [key]: value };
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (key: string) => {
          store.delete(key);
        },
      },
    },
  } as unknown as typeof chrome;
  return { store };
}

const NOW = 1_000_000;

beforeEach(() => {
  installStorage();
});

describe('pending jump', () => {
  it('hands the request to the matching page, once', async () => {
    await setPendingJump('https://ex.org/a', 'anno-1', NOW);
    expect(await takePendingJump('https://ex.org/a', NOW + 500)).toBe('anno-1');
    // Claimed: a second load of the same page must not scroll again.
    expect(await takePendingJump('https://ex.org/a', NOW + 600)).toBeUndefined();
  });

  it('does not fire on a different page, and clears so it cannot fire later', async () => {
    await setPendingJump('https://ex.org/a', 'anno-1', NOW);
    expect(await takePendingJump('https://other.org/b', NOW + 100)).toBeUndefined();
    expect(await takePendingJump('https://ex.org/a', NOW + 200)).toBeUndefined();
  });

  it('ignores a stale request rather than scrolling on some later visit', async () => {
    await setPendingJump('https://ex.org/a', 'anno-1', NOW);
    expect(await takePendingJump('https://ex.org/a', NOW + 61_000)).toBeUndefined();
  });

  it('keeps only the newest request — a second click supersedes the first', async () => {
    await setPendingJump('https://ex.org/a', 'anno-1', NOW);
    await setPendingJump('https://ex.org/a', 'anno-2', NOW + 10);
    expect(await takePendingJump('https://ex.org/a', NOW + 20)).toBe('anno-2');
  });

  it('survives storage being unavailable', async () => {
    globalThis.chrome = {
      storage: {
        local: {
          get: async () => {
            throw new Error('unavailable');
          },
          set: async () => {
            throw new Error('unavailable');
          },
          remove: async () => {},
        },
      },
    } as unknown as typeof chrome;
    await expect(setPendingJump('https://ex.org/a', 'x', NOW)).resolves.toBeUndefined();
    await expect(takePendingJump('https://ex.org/a', NOW)).resolves.toBeUndefined();
  });
});

describe('sameDocumentUrl', () => {
  it('treats the same document reached by a slightly different address as the same', () => {
    const base = 'https://journals.example.org/doi/10.1177/123';
    expect(sameDocumentUrl(base, base)).toBe(true);
    expect(sameDocumentUrl(base, `${base}/`)).toBe(true);
    expect(sameDocumentUrl(base, `${base}#abstract`)).toBe(true);
    expect(sameDocumentUrl(base, `${base}?utm_source=twitter`)).toBe(true);
    expect(sameDocumentUrl(base, base.toUpperCase().replace('HTTPS', 'https'))).toBe(true);
  });

  it('keeps genuinely different documents apart, including by query', () => {
    expect(sameDocumentUrl('https://ex.org/a', 'https://ex.org/b')).toBe(false);
    expect(sameDocumentUrl('https://ex.org/a', 'https://other.org/a')).toBe(false);
    // A query that selects content is part of the document's identity.
    expect(sameDocumentUrl('https://ex.org/view?id=1', 'https://ex.org/view?id=2')).toBe(false);
  });

  it('falls back to plain comparison for values that are not URLs', () => {
    expect(sameDocumentUrl('not a url', 'not a url')).toBe(true);
    expect(sameDocumentUrl('not a url', 'other')).toBe(false);
  });
});
