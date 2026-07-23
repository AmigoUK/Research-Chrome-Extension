/**
 * Background service worker (MV3).
 *
 * The worker is ephemeral — Chrome terminates it after ~30s of inactivity —
 * so every handler assumes a cold start. Persistent state lives in IndexedDB;
 * the database handle is opened lazily and cached for the worker's lifetime.
 */
import { openContextNotesDB } from '../adapters/idb/db';
import { createRepositories } from '../adapters/idb/repositories';
import { registerMessageRouter } from '../adapters/chrome/messaging';
import { CiteJsFormatter } from '../adapters/citation/citejs';
import type { RepositorySet } from '../core/ports/repositories';

let reposPromise: Promise<RepositorySet> | undefined;

function getRepositories(): Promise<RepositorySet> {
  reposPromise ??= openContextNotesDB().then(createRepositories);
  return reposPromise;
}

// Clicking the toolbar action opens the side panel — the primary surface.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[context-notes] setPanelBehavior failed', err));
});

// Route typed messages from the UI to the pure domain router.
registerMessageRouter(getRepositories, { formatter: new CiteJsFormatter() });
