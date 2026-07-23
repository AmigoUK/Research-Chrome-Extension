/**
 * Page scanning for capture.
 *
 * `scanDocumentRaw` is self-contained (reads only DOM globals, no imports) so
 * it can be injected into a tab via `chrome.scripting.executeScript`. It
 * returns primitives only; `buildCaptureInput` turns them into a CaptureInput
 * in the extension context.
 */
import type { RawPageMetadata } from '../../core/extract/metadata';
import { buildDocumentMetadata, inferDocumentType } from '../../core/extract/metadata';
import type { CaptureInput } from '../../core/usecases/capture';
import type { Id } from '../../core/model/types';

export interface RawPageScan {
  url: string;
  raw: RawPageMetadata;
}

/** Read title, meta tags, authors, and canonical URL from the current page. */
export function scanDocumentRaw(): RawPageScan {
  const metaTags: Record<string, string> = {};
  const authors: string[] = [];

  for (const meta of Array.from(document.querySelectorAll('meta'))) {
    const key = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    const content = meta.getAttribute('content');
    if (!key || !content) continue;
    if (key === 'citation_author' || key === 'dc.creator') {
      authors.push(content.trim());
    } else if (!(key in metaTags)) {
      metaTags[key] = content;
    }
  }

  const canonical =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
  const url = canonical ?? document.location.href;

  const raw: RawPageMetadata = { metaTags };
  if (document.title) raw.title = document.title;
  if (authors.length) raw.authors = authors;
  if (canonical) raw.canonicalUrl = canonical;

  return { url, raw };
}

/** Build a CaptureInput from a raw page scan. */
export function buildCaptureInput(
  scan: RawPageScan,
  projectId: Id,
  section?: string,
): CaptureInput {
  const metadata = buildDocumentMetadata(scan.raw);
  return {
    projectId,
    url: scan.url,
    type: inferDocumentType(metadata),
    metadata,
    ...(section ? { section } : {}),
  };
}
