/**
 * "Open that page and scroll to that highlight."
 *
 * Jumping inside the CURRENT page is a direct message to the content script.
 * Jumping from the dashboard is different: the target page may not be open,
 * the annotator may not be injected yet, and the annotation's overlay does
 * not exist until anchors resolve — so a message sent at open time would
 * arrive before there is anything to scroll to.
 *
 * The request is therefore parked in `chrome.storage.local` and *collected*
 * by the annotator once it has painted: whoever gets there last does the
 * work, no timing assumptions either way. One slot only — a second request
 * replaces the first, which is what a user clicking twice means anyway.
 */

const KEY = 'pendingJump';

export interface PendingJump {
  url: string;
  annotationId: string;
  /** Stale requests are dropped rather than firing on some later visit. */
  at: number;
}

/** Requests older than this are ignored — see `takePendingJump`. */
const MAX_AGE_MS = 60_000;

export async function setPendingJump(
  url: string,
  annotationId: string,
  now: number,
): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: { url, annotationId, at: now } satisfies PendingJump });
  } catch {
    // The page still opens; it just will not auto-scroll.
  }
}

/**
 * Claim a jump for this URL, if one is waiting. Clears it either way, so a
 * request never fires twice or lingers into an unrelated later visit.
 */
export async function takePendingJump(url: string, now: number): Promise<string | undefined> {
  try {
    const stored = await chrome.storage.local.get(KEY);
    const pending = stored[KEY] as PendingJump | undefined;
    if (!pending) return undefined;
    await chrome.storage.local.remove(KEY);
    if (pending.url !== url) return undefined;
    if (now - pending.at > MAX_AGE_MS) return undefined;
    return pending.annotationId;
  } catch {
    return undefined;
  }
}
