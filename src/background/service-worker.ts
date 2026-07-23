/**
 * Background service worker (MV3).
 *
 * The worker is ephemeral — Chrome terminates it after ~30s of inactivity —
 * so every handler assumes a cold start and holds no critical state in memory.
 * Persistent state lives in IndexedDB (added in a later milestone).
 */

// Clicking the toolbar action opens the side panel — the primary surface.
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[context-notes] setPanelBehavior failed', err));
});

// Placeholder message router. The typed contract and use-case dispatch
// are introduced with the domain core (milestone M2).
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'PING'
  ) {
    sendResponse({ type: 'PONG' });
  }
  return false;
});
