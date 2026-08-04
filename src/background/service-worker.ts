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
import { registerAnnotatorControl } from './annotator-control';
import { recordUpdate } from '../adapters/chrome/update-notice';
import { CiteJsFormatter, type CslLoader } from '../adapters/citation/citejs';
import { createFetchCslLoader } from '../adapters/citation/csl-assets';
import { isCustomBaseStyleId } from '../core/citation/parse';
import type { RepositorySet } from '../core/ports/repositories';

let reposPromise: Promise<RepositorySet> | undefined;

function getRepositories(): Promise<RepositorySet> {
  reposPromise ??= openContextNotesDB().then(createRepositories);
  return reposPromise;
}

/**
 * Base styles come from two places: the six vendored files, fetched as extension
 * assets, and styles the user imported, which live in IndexedDB. An id says
 * which is which, so the formatter needs to know neither.
 */
function createCslLoader(): CslLoader {
  const fromAssets = createFetchCslLoader();
  return async (template) => {
    if (!isCustomBaseStyleId(template)) return fromAssets(template);
    const repos = await getRepositories();
    return (await repos.customBaseStyles.get(template))?.xml;
  };
}

// Clicking the toolbar action opens the side panel — the primary surface.
chrome.runtime.onInstalled.addListener((details) => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[context-notes] setPanelBehavior failed', err));
  // First install only — not updates: a returning user already knows the
  // moves, and a surprise tab on every update is how tutorials get hated.
  if (details.reason === 'install') {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL('src/onboarding/index.html') })
      .catch(() => {});
  }
  // Updates are silent by store design — announce them quietly instead: a
  // NEW badge on the icon plus a dismissable one-liner in the panel. No
  // surprise tabs.
  if (details.reason === 'update') {
    const version = chrome.runtime.getManifest().version;
    if (details.previousVersion && details.previousVersion !== version) {
      void recordUpdate(version);
    }
  }
});

// Route typed messages from the UI to the pure domain router.
registerMessageRouter(getRepositories, { formatter: new CiteJsFormatter(createCslLoader()) });

// Wire the chrome.* glue for the web annotator (activate / registerOrigin / changed).
// A second onMessage listener, keyed on a `control` field so it never collides
// with the router's typed messages.
registerAnnotatorControl();
