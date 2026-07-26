/**
 * Service-worker glue for the web annotator. Everything here is chrome.* — it is
 * deliberately outside the pure router. Control messages carry a `control` field
 * so they never collide with the typed domain messages.
 */
const ANNOTATOR_FILE = 'annotator.js';

export interface ControlMessage {
  control: 'annotator/activate' | 'annotator/registerOrigin' | 'annotator/changed';
  origin?: string;
  url?: string;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function activate(): Promise<{ ok: boolean }> {
  const tabId = await activeTabId();
  if (tabId == null) return { ok: false };
  await chrome.scripting.executeScript({ target: { tabId }, files: [ANNOTATOR_FILE] });
  return { ok: true };
}

async function registerOrigin(origin: string): Promise<{ registered: boolean }> {
  const pattern = `${origin}/*`;
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
        await broadcast(message.url);
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
