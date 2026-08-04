/**
 * `chrome.runtime` messaging adapter.
 *
 * Client: `sendRequest` is a typed wrapper around `chrome.runtime.sendMessage`.
 * Server: `registerMessageRouter` wires incoming messages to the pure router,
 * resolving repositories lazily so the ephemeral service worker can cold-start.
 */
import { handleRequest, type RouterDeps } from '../../core/router';
import type { RepositorySet } from '../../core/ports/repositories';
import type { MessageMap, MessageType, Request, Result } from '../../core/messages';

/** Send a typed request to the service worker and unwrap the result. */
export async function sendRequest<T extends MessageType>(
  request: Request<T>,
): Promise<MessageMap[T]['res']> {
  const result = (await chrome.runtime.sendMessage(request)) as Result<T>;
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.data;
}

/**
 * Message types whose success means stored data changed. Every UI surface
 * renders from its own in-memory copy, so without a signal the side panel
 * showed "0 sources" while the dashboard filed pages, and the dashboard's
 * Annotations view stayed empty while the PDF reader saved highlights —
 * each stale until a full reload.
 */
const MUTATING =
  /\/(put|delete|import|importByDoi|enrichFromDoi|invite|setRole|remove|start|reply|setResolved)$|^capture\/page$|^web\/annotate$/;

/** True when a successful request of this type should broadcast a change. */
export function mutatesData(type: string): boolean {
  return MUTATING.test(type);
}

/** Fire-and-forget "stored data changed" signal to every extension page. */
function broadcastDataChanged(type: string): void {
  chrome.runtime.sendMessage({ control: 'data/changed', changedBy: type }).catch(() => {});
}

/**
 * The only domain messages the injected annotator sends. Content scripts run
 * inside web pages the user opted into; a compromised renderer there must not
 * inherit the full ~45-message API (bulk deletes, snapshot import, file
 * reads). Extension pages — whose sender origin is our own — keep everything.
 */
const CONTENT_SCRIPT_MESSAGES = new Set(['web/annotate', 'web/annotationsForUrl']);

/** True when this sender may issue this message type. */
export function senderMayRequest(
  type: string,
  sender: { origin?: string | undefined } | undefined,
  extensionOrigin: string,
): boolean {
  const origin = sender?.origin;
  if (!origin || origin === extensionOrigin) return true; // our own pages
  return CONTENT_SCRIPT_MESSAGES.has(type);
}

/**
 * Register the router on `chrome.runtime.onMessage`. `getRepos` is awaited on
 * each message (typically returning a cached open-DB promise).
 */
export function registerMessageRouter(
  getRepos: () => Promise<RepositorySet>,
  deps: RouterDeps = {},
): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Control messages (annotator activation, per-origin registration, change
    // broadcast) are owned by a separate listener in annotator-control.ts. If we
    // answered them here too, our faster reply would win the shared response
    // channel and the real handler's response would be dropped.
    if (message && typeof (message as { control?: unknown }).control === 'string') return;
    void (async () => {
      try {
        const requestType = (message as { type?: unknown })?.type;
        if (
          typeof requestType === 'string' &&
          !senderMayRequest(requestType, sender, `chrome-extension://${chrome.runtime.id}`)
        ) {
          sendResponse({ ok: false, error: 'Not available from this context' });
          return;
        }
        const repos = await getRepos();
        const result = await handleRequest(repos, message, deps);
        sendResponse(result);
        const type = (message as { type?: unknown })?.type;
        if (result.ok && typeof type === 'string' && mutatesData(type)) {
          broadcastDataChanged(type);
        }
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return true; // keep the channel open for the async response
  });
}
