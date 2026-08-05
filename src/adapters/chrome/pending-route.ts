/**
 * "Open the dashboard, already on this screen."
 *
 * `chrome.runtime.openOptionsPage()` takes no arguments — it cannot say which
 * route to land on, and if a dashboard tab is already open it is simply
 * focused, not reloaded. A cross-surface link (the guide's Outline step)
 * therefore parks the target route in `chrome.storage.local` and the
 * dashboard's own init claims it once, on its next fresh load — the same
 * handoff `pending-jump.ts` uses for "open this page and scroll to that
 * highlight". One slot only: a second request before the first is claimed
 * replaces it, which is what clicking a second link before the first tab
 * finished loading means anyway.
 */

const KEY = 'pendingRoute';

export async function setPendingRoute(route: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: route });
  } catch {
    // The dashboard still opens; it just lands on Overview instead.
  }
}

/**
 * Claim the pending route, if any. Clears it either way, so a stale request
 * never fires again on some later, unrelated visit to the dashboard.
 *
 * Returns a plain string, not `NavRoute`: this adapter sits under
 * `adapters/chrome`, below `src/options` in the ports-and-adapters layering,
 * so it cannot import the dashboard's own route type. The caller validates.
 */
export async function takePendingRoute(): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const route = stored[KEY];
    await chrome.storage.local.remove(KEY);
    return typeof route === 'string' ? route : undefined;
  } catch {
    return undefined;
  }
}
