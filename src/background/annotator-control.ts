/**
 * Service-worker glue for the web annotator. Everything here is chrome.* — it is
 * deliberately outside the pure router. Control messages carry a `control` field
 * so they never collide with the typed domain messages.
 */
import { setPendingJump } from '../adapters/chrome/pending-jump';
const ANNOTATOR_FILE = 'annotator.js';

export interface ControlMessage {
  control:
    | 'annotator/activate'
    | 'annotator/registerOrigin'
    | 'annotator/changed'
    | 'annotator/focus'
    | 'annotator/jump'
    | 'annotator/openAndJump'
    | 'annotator/resolved';
  origin?: string;
  url?: string;
  id?: string;
  resolvedIds?: string[];
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export async function activate(): Promise<{ ok: boolean }> {
  const tabId = await activeTabId();
  if (tabId == null) return { ok: false };
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [ANNOTATOR_FILE] });
    return { ok: true };
  } catch {
    // A chrome:// page, the Web Store, the built-in PDF viewer, or a tab closed
    // mid-injection all reject executeScript. Report it rather than letting the
    // throw escape the listener's async IIFE — an unanswered sendResponse leaves
    // the sender's channel hanging until the port times out.
    return { ok: false };
  }
}

export async function registerOrigin(origin: string): Promise<{ registered: boolean }> {
  const pattern = `${origin}/*`;
  try {
    const granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) return { registered: false };
    const id = `annotator-${origin.replace(/[^a-z0-9]/gi, '-')}`;
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [id] });
    } catch {
      // not registered yet — fine
    }
    await chrome.scripting.registerContentScripts([
      { id, matches: [pattern], js: [ANNOTATOR_FILE], world: 'ISOLATED', runAt: 'document_idle' },
    ]);
    return { registered: true };
  } catch {
    // A denied prompt is already handled above; this catches request/register
    // *rejecting* (offline, quota, an invalid pattern) — same hung-channel risk.
    return { registered: false };
  }
}

/**
 * When the user revokes a site's access in chrome://extensions, the registered
 * content script for that origin would otherwise stay behind as an orphan —
 * still listed, silently failing to inject. Mirror the revocation by
 * unregistering every registration whose matches fall inside a removed origin,
 * so Site access in Chrome's UI remains the single source of truth.
 */
export async function unregisterRevokedOrigins(removedOrigins: string[]): Promise<void> {
  if (removedOrigins.length === 0) return;
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const removed = removedOrigins.map((pattern) => pattern.replace(/\/\*$/, ''));
    const ids = scripts
      .filter((s) => s.js?.includes(ANNOTATOR_FILE))
      .filter((s) => (s.matches ?? []).every((m) => removed.some((o) => m.startsWith(o))))
      .map((s) => s.id);
    if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });
  } catch {
    // Best-effort cleanup; an orphaned registration fails closed (no permission,
    // no injection), so a cleanup failure is cosmetic rather than a leak.
  }
}

/**
 * "Show me that highlight" from the dashboard: focus the page if it is
 * already open (an exact-URL tab), else open it, then make sure the
 * annotator runs there. The scroll itself is collected by the annotator from
 * the parked request (see adapters/chrome/pending-jump.ts) once its overlays
 * exist — the only moment at which scrolling to one is possible.
 */
export async function openAndJump(url: string, annotationId: string): Promise<{ ok: boolean }> {
  try {
    await setPendingJump(url, annotationId, Date.now());
    const [existing] = await chrome.tabs.query({ url });
    let tabId = existing?.id;
    if (tabId != null) {
      await chrome.tabs.update(tabId, { active: true });
      if (existing?.windowId != null) {
        await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
      }
    } else {
      const created = await chrome.tabs.create({ url });
      tabId = created.id;
      // A fresh tab has to finish loading before anything can be injected.
      if (tabId != null) await waitForTabLoad(tabId);
    }
    if (tabId == null) return { ok: false };
    // Idempotent: an already-running annotator re-syncs and returns early.
    await chrome.scripting.executeScript({ target: { tabId }, files: [ANNOTATOR_FILE] });
    return { ok: true };
  } catch {
    // No host access for that origin (or an unscriptable page): the tab is
    // open at the right URL, which is most of what the user asked for.
    return { ok: false };
  }
}

/** Resolve once the tab reports `complete` (or immediately, if it already has). */
function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.TabChangeInfo): void => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') done();
    });
  });
}

/** Tell every context (side panel + the tab's content script) that a URL changed. */
async function broadcast(url: string): Promise<void> {
  chrome.runtime.sendMessage({ control: 'annotator/changed', url }).catch(() => {});
  const tabId = await activeTabId();
  if (tabId != null)
    chrome.tabs.sendMessage(tabId, { control: 'annotator/changed', url }).catch(() => {});
}

/** Wire the control listener. Returns synchronously; replies are async. */
export function registerAnnotatorControl(): void {
  chrome.permissions.onRemoved.addListener((permissions) => {
    void unregisterRevokedOrigins(permissions.origins ?? []);
  });
  chrome.runtime.onMessage.addListener((message: ControlMessage, _sender, sendResponse) => {
    if (!message || typeof message.control !== 'string') return; // not ours — let the router handle it
    void (async () => {
      if (message.control === 'annotator/activate') {
        sendResponse(await activate());
      } else if (message.control === 'annotator/registerOrigin' && message.origin) {
        sendResponse(await registerOrigin(message.origin));
      } else if (message.control === 'annotator/changed' && message.url) {
        // Open the side panel on the user gesture that produced the annotation —
        // opening it later (e.g. after an await with no gesture) would be
        // rejected by Chrome's user-gesture requirement for sidePanel.open.
        const tabId = await activeTabId();
        if (tabId != null) await chrome.sidePanel.open({ tabId }).catch(() => {});
        await broadcast(message.url);
        sendResponse({ ok: true });
      } else if (message.control === 'annotator/focus' && message.id) {
        // Content-script overlay click → forward to the side panel (an extension
        // page, reached via runtime.sendMessage, not tabs.sendMessage).
        chrome.runtime.sendMessage({ control: 'annotator/focus', id: message.id }).catch(() => {});
        sendResponse({ ok: true });
      } else if (message.control === 'annotator/jump' && message.id) {
        // Side panel "Jump to" → forward to the active tab's content script (an
        // injected page context, reached via tabs.sendMessage, not runtime.sendMessage).
        const tabId = await activeTabId();
        if (tabId != null)
          chrome.tabs
            .sendMessage(tabId, { control: 'annotator/jump', id: message.id })
            .catch(() => {});
        sendResponse({ ok: true });
      } else if (message.control === 'annotator/openAndJump' && message.url && message.id) {
        sendResponse(await openAndJump(message.url, message.id));
      } else if (message.control === 'annotator/resolved' && message.url) {
        // Content script reports which annotations it could place on the page →
        // forward to the side panel so it can flag the rest as unplaced.
        chrome.runtime
          .sendMessage({
            control: 'annotator/resolved',
            url: message.url,
            resolvedIds: message.resolvedIds,
          })
          .catch(() => {});
        sendResponse({ ok: true });
      } else {
        // Unrecognized verb, or a recognized one missing its required field
        // (e.g. registerOrigin with no origin). Reply anyway so the sender's
        // channel resolves instead of hanging until the port times out.
        sendResponse({ ok: false });
      }
    })();
    return true;
  });
}
