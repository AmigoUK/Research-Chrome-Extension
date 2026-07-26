/**
 * Service-worker glue for the web annotator. Everything here is chrome.* — it is
 * deliberately outside the pure router. Control messages carry a `control` field
 * so they never collide with the typed domain messages.
 */
const ANNOTATOR_FILE = 'annotator.js';

export interface ControlMessage {
  control:
    | 'annotator/activate'
    | 'annotator/registerOrigin'
    | 'annotator/changed'
    | 'annotator/focus'
    | 'annotator/jump'
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

/** Tell every context (side panel + the tab's content script) that a URL changed. */
async function broadcast(url: string): Promise<void> {
  chrome.runtime.sendMessage({ control: 'annotator/changed', url }).catch(() => {});
  const tabId = await activeTabId();
  if (tabId != null) chrome.tabs.sendMessage(tabId, { control: 'annotator/changed', url }).catch(() => {});
}

/** Wire the control listener. Returns synchronously; replies are async. */
export function registerAnnotatorControl(): void {
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
        if (tabId != null) chrome.tabs.sendMessage(tabId, { control: 'annotator/jump', id: message.id }).catch(() => {});
        sendResponse({ ok: true });
      } else if (message.control === 'annotator/resolved' && message.url) {
        // Content script reports which annotations it could place on the page →
        // forward to the side panel so it can flag the rest as unplaced.
        chrome.runtime
          .sendMessage({ control: 'annotator/resolved', url: message.url, resolvedIds: message.resolvedIds })
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
