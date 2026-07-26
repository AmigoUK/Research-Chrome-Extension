import { describe, it, expect } from 'vitest';
import { fetchPdfBytes } from './fetch-pdf';

/** Build a minimal Response-like object the way `fetchPdfBytes` reads it. */
function res(opts: {
  status?: number;
  contentType?: string;
  contentLength?: string;
  body?: Uint8Array;
}): Response {
  const headers = new Map<string, string>();
  if (opts.contentType) headers.set('content-type', opts.contentType);
  if (opts.contentLength) headers.set('content-length', opts.contentLength);
  const body = opts.body ?? new Uint8Array();
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

/** A real PDF starts with the `%PDF-` magic bytes. */
function pdfBody(extra = 'fake pdf'): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${extra}`);
}

describe('fetchPdfBytes', () => {
  it('returns the bytes for a valid PDF response', async () => {
    const body = pdfBody();
    const buf = await fetchPdfBytes('https://ex.com/a.pdf', {
      fetchFn: async () => res({ contentType: 'application/pdf', body }),
    });
    expect(new Uint8Array(buf)).toEqual(body);
  });

  it('throws on a non-ok HTTP status', async () => {
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', { fetchFn: async () => res({ status: 404 }) }),
    ).rejects.toThrow(/404/);
  });

  it('rejects an HTML login page served with status 200', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>Sign in</title>');
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', {
        fetchFn: async () => res({ contentType: 'text/html', body: html }),
      }),
    ).rejects.toThrow(/not a pdf|did not return a pdf/i);
  });

  it('rejects a body whose bytes are not a PDF even if content-type claims pdf', async () => {
    const notPdf = new TextEncoder().encode('just some text, no magic');
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', {
        fetchFn: async () => res({ contentType: 'application/pdf', body: notPdf }),
      }),
    ).rejects.toThrow(/not a pdf|did not return a pdf/i);
  });

  it('rejects when the Content-Length header exceeds the cap (before downloading)', async () => {
    let downloaded = false;
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', {
        maxBytes: 1000,
        fetchFn: async () =>
          ({
            ok: true,
            status: 200,
            headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? '2000' : null) },
            arrayBuffer: async () => {
              downloaded = true;
              return new ArrayBuffer(2000);
            },
          }) as unknown as Response,
      }),
    ).rejects.toThrow(/too large/i);
    expect(downloaded).toBe(false);
  });

  it('rejects when the downloaded body exceeds the cap (no Content-Length header)', async () => {
    const big = new Uint8Array(2000);
    big.set(pdfBody(), 0);
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', {
        maxBytes: 1000,
        fetchFn: async () => res({ contentType: 'application/pdf', body: big }),
      }),
    ).rejects.toThrow(/too large/i);
  });

  it('maps an AbortError to a timeout message', async () => {
    await expect(
      fetchPdfBytes('https://ex.com/a.pdf', {
        fetchFn: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('passes an AbortSignal to fetch so a hung request can be cancelled', async () => {
    let sawSignal = false;
    await fetchPdfBytes('https://ex.com/a.pdf', {
      fetchFn: async (_url, init) => {
        sawSignal = init?.signal instanceof AbortSignal;
        return res({ contentType: 'application/pdf', body: pdfBody() });
      },
    });
    expect(sawSignal).toBe(true);
  });
});
