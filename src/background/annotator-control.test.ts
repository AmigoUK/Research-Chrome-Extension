import { describe, it, expect } from 'vitest';
import { activate, registerOrigin } from './annotator-control';

/**
 * Minimal, configurable chrome.* fake. The behaviours under test are the error
 * paths: a rejected executeScript / permissions.request / registerContentScripts
 * must resolve to a negative result, NOT throw — a throw here escapes the async
 * IIFE in the message listener and the sender's channel hangs until it times out.
 */
function installChrome(
  over: {
    activeTabId?: number | undefined;
    executeScriptThrows?: boolean;
    permissionGranted?: boolean;
    requestThrows?: boolean;
    registerThrows?: boolean;
  } = {},
): { executeScript: number; registerContentScripts: number; lastFiles: string[] | undefined } {
  const calls: { executeScript: number; registerContentScripts: number; lastFiles: string[] | undefined } = {
    executeScript: 0,
    registerContentScripts: 0,
    lastFiles: undefined,
  };
  const tabId = 'activeTabId' in over ? over.activeTabId : 7;
  globalThis.chrome = {
    tabs: { query: async () => (tabId == null ? [] : [{ id: tabId }]) },
    scripting: {
      executeScript: async (injection: { files?: string[] }) => {
        calls.executeScript++;
        calls.lastFiles = injection.files;
        if (over.executeScriptThrows) throw new Error('cannot script this page');
        return [];
      },
      unregisterContentScripts: async () => {},
      registerContentScripts: async () => {
        calls.registerContentScripts++;
        if (over.registerThrows) throw new Error('register failed');
      },
    },
    permissions: {
      request: async () => {
        if (over.requestThrows) throw new Error('request failed');
        return over.permissionGranted ?? true;
      },
    },
  } as unknown as typeof chrome;
  return calls;
}

describe('activate', () => {
  it('injects the annotator into the active tab and reports ok', async () => {
    const calls = installChrome();
    const result = await activate();
    expect(result).toEqual({ ok: true });
    expect(calls.executeScript).toBe(1);
    expect(calls.lastFiles).toEqual(['annotator.js']);
  });

  it('reports not-ok when there is no active tab', async () => {
    const calls = installChrome({ activeTabId: undefined });
    expect(await activate()).toEqual({ ok: false });
    expect(calls.executeScript).toBe(0);
  });

  it('reports not-ok (does not throw) when the page cannot be scripted', async () => {
    installChrome({ executeScriptThrows: true });
    await expect(activate()).resolves.toEqual({ ok: false });
  });
});

describe('registerOrigin', () => {
  it('registers a content script and reports registered on success', async () => {
    const calls = installChrome({ permissionGranted: true });
    expect(await registerOrigin('https://ex.com')).toEqual({ registered: true });
    expect(calls.registerContentScripts).toBe(1);
  });

  it('reports not-registered when the host permission is denied', async () => {
    const calls = installChrome({ permissionGranted: false });
    expect(await registerOrigin('https://ex.com')).toEqual({ registered: false });
    expect(calls.registerContentScripts).toBe(0);
  });

  it('reports not-registered (does not throw) when permissions.request rejects', async () => {
    installChrome({ requestThrows: true });
    await expect(registerOrigin('https://ex.com')).resolves.toEqual({ registered: false });
  });

  it('reports not-registered (does not throw) when registerContentScripts rejects', async () => {
    installChrome({ permissionGranted: true, registerThrows: true });
    await expect(registerOrigin('https://ex.com')).resolves.toEqual({ registered: false });
  });
});
