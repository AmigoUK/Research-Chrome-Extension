/**
 * Detects that the page URL changed — the signal the annotator needs to
 * re-anchor after a client-side (SPA) navigation, where the document stays but
 * the URL (and its content) does not. A content script in the ISOLATED world
 * cannot patch the page's `history.pushState`/`replaceState` (those live in the
 * main world), so the wiring polls plus listens to `popstate`/Navigation API and
 * funnels every candidate through `check()`. This holds the last-seen URL and
 * fires `onChange` only on an actual change, so redundant triggers are harmless.
 */
export interface UrlWatcher {
  /** Compare the current URL to the last-seen one; fire `onChange` if it moved. */
  check: () => void;
}

export function createUrlWatcher(getUrl: () => string, onChange: (url: string) => void): UrlWatcher {
  let last = getUrl();
  return {
    check() {
      const now = getUrl();
      if (now !== last) {
        last = now;
        onChange(now);
      }
    },
  };
}
