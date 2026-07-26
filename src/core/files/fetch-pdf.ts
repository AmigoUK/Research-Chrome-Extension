/**
 * Fetch a PDF by URL, defensively. A raw `fetch(url)` for a "PDF" URL has three
 * ways to poison the file cache: it can hang forever (no timeout), it can store
 * a login/HTML error page that returned 200 as if it were a PDF, and it can pull
 * an unbounded body into memory and across the runtime message channel. This
 * guards all three. The network call is injected so the logic is unit-testable
 * without a network (mirrors `ImportDeps.fetchCsl` in usecases/references.ts).
 */
export interface FetchPdfDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB — a research PDF that dwarfs this is almost certainly the wrong file.

/** Returns the PDF bytes, or throws a user-facing Error explaining why not. */
export async function fetchPdfBytes(url: string, deps: FetchPdfDeps = {}): Promise<ArrayBuffer> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: abort.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

    // An auth wall or error page usually declares itself as HTML — reject it
    // before pulling the body, so a huge HTML page can't blow the cap either.
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) throw new Error('That URL did not return a PDF');

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`PDF is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`);
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new Error(`PDF is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`);
    }

    // The content-type can lie (or be absent); the magic bytes cannot. A real
    // PDF begins with "%PDF-". This is what actually rejects a 200-OK login page.
    const magic = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
    if (!magic.startsWith('%PDF-')) throw new Error('That URL did not return a PDF');

    return buf;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('PDF fetch timed out — check the connection and try again');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
