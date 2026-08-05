import { describe, it, expect, beforeEach } from 'vitest';
import { setPendingRoute, takePendingRoute } from './pending-route';

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

beforeEach(() => {
  installStorage();
});

describe('pending route', () => {
  it('hands the route to the dashboard, once', async () => {
    await setPendingRoute('outline');
    expect(await takePendingRoute()).toBe('outline');
    // Claimed: a later, unrelated load of the dashboard must not jump again.
    expect(await takePendingRoute()).toBeUndefined();
  });

  it('returns undefined when nothing is pending', async () => {
    expect(await takePendingRoute()).toBeUndefined();
  });

  it('keeps only the newest request — a second click supersedes the first', async () => {
    await setPendingRoute('outline');
    await setPendingRoute('annotations');
    expect(await takePendingRoute()).toBe('annotations');
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
    await expect(setPendingRoute('outline')).resolves.toBeUndefined();
    await expect(takePendingRoute()).resolves.toBeUndefined();
  });
});
