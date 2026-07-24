/**
 * Base CSL styles, fetched from the extension's own files instead of being
 * inlined into the bundle.
 *
 * The six vendored styles are ~520 kB of XML; the notes-and-bibliography
 * Chicago alone is 243 kB. Inlining them made every service-worker cold start
 * parse the lot, whether or not a citation was ever formatted. `?url` keeps the
 * files as separate assets that Vite emits and hashes, and they are fetched on
 * first use and cached for the worker's lifetime.
 *
 * Same-origin extension files need no `web_accessible_resources` entry: the
 * service worker and the dashboard both run on the extension's own origin.
 */
import apaUrl from '../../assets/csl/apa.csl?url';
import harvardUrl from '../../assets/csl/harvard1.csl?url';
import vancouverUrl from '../../assets/csl/vancouver.csl?url';
import chicagoAuthorDateUrl from '../../assets/csl/chicago-author-date.csl?url';
import chicagoNotesUrl from '../../assets/csl/chicago-notes-bibliography.csl?url';
import mlaUrl from '../../assets/csl/modern-language-association.csl?url';
import type { CslLoader } from './citejs';

/** Asset URL keyed by citation-js template name. */
export const CSL_URLS: Record<string, string> = {
  apa: apaUrl,
  harvard1: harvardUrl,
  vancouver: vancouverUrl,
  'chicago-author-date': chicagoAuthorDateUrl,
  'chicago-notes-bibliography': chicagoNotesUrl,
  'modern-language-association': mlaUrl,
};

/** Fetch-backed loader for the browser and the service worker. */
export function createFetchCslLoader(): CslLoader {
  const cache = new Map<string, Promise<string | undefined>>();
  return (template: string) => {
    const url = CSL_URLS[template];
    if (!url) return Promise.resolve(undefined);
    let pending = cache.get(template);
    if (!pending) {
      pending = fetch(url)
        .then((res) => (res.ok ? res.text() : undefined))
        .catch(() => undefined);
      cache.set(template, pending);
    }
    return pending;
  };
}
