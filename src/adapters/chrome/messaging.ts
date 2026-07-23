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
 * Register the router on `chrome.runtime.onMessage`. `getRepos` is awaited on
 * each message (typically returning a cached open-DB promise).
 */
export function registerMessageRouter(
  getRepos: () => Promise<RepositorySet>,
  deps: RouterDeps = {},
): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void (async () => {
      try {
        const repos = await getRepos();
        sendResponse(await handleRequest(repos, message, deps));
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
