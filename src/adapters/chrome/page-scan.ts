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
  const fallbackAuthors: string[] = [];

  for (const meta of Array.from(document.querySelectorAll('meta'))) {
    const key = (meta.getAttribute('name') ?? meta.getAttribute('property') ?? '').toLowerCase();
    const content = meta.getAttribute('content');
    if (!key || !content) continue;
    // citation_author and dc.creator carry the SAME people in different
    // shapes ("Juliana Antunes Azevedo" vs "Azevedo, Juliana Antunes") —
    // MDPI serves both. Pooling them doubled every author list, so they are
    // kept apart and dc.creator is used only when no Highwire tags exist.
    if (key === 'citation_author') {
      authors.push(content.trim());
    } else if (key === 'dc.creator') {
      fallbackAuthors.push(content.trim());
    } else if (!(key in metaTags)) {
      metaTags[key] = content;
    }
  }

  const canonical =
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
  const url = canonical ?? document.location.href;

  // schema.org Article/ScholarlyArticle JSON-LD — the standard fallback for
  // pages (institutional repositories, news sites) that carry no Highwire or
  // Dublin Core tags at all. Everything here is defensive: one broken script
  // block must not cost the scan. (This function is injected whole, so the
  // walk is inlined rather than imported.)
  let jsonLd: RawPageMetadata['jsonLd'];
  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const parsed: unknown = JSON.parse(script.textContent ?? '');
      const nodes: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { '@graph'?: unknown[] })['@graph'])
          ? ((parsed as { '@graph': unknown[] })['@graph'] ?? [])
          : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const item = node as Record<string, unknown>;
        const type = ([] as unknown[]).concat(item['@type'] ?? []).map(String);
        if (!type.some((t) => /Article$/i.test(t))) continue;
        const name = (v: unknown): string | undefined =>
          typeof v === 'string'
            ? v
            : v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string'
              ? ((v as { name: string }).name ?? undefined)
              : undefined;
        const ldAuthors = ([] as unknown[])
          .concat(item['author'] ?? [])
          .map(name)
          .filter((a): a is string => !!a);
        jsonLd = {};
        const ldTitle = name(item['headline']) ?? name(item['name']);
        if (ldTitle) jsonLd.title = ldTitle;
        if (ldAuthors.length) jsonLd.authors = ldAuthors;
        if (typeof item['datePublished'] === 'string') jsonLd.date = item['datePublished'];
        const journal = name(item['isPartOf']);
        if (journal) jsonLd.journal = journal;
        const publisher = name(item['publisher']);
        if (publisher) jsonLd.publisher = publisher;
        break;
      }
    } catch {
      // not JSON, or not ours — skip this block
    }
    if (jsonLd) break;
  }

  const raw: RawPageMetadata = { metaTags };
  if (document.title) raw.title = document.title;
  if (authors.length) raw.authors = authors;
  else if (fallbackAuthors.length) raw.authors = fallbackAuthors;
  if (canonical) raw.canonicalUrl = canonical;
  if (jsonLd) raw.jsonLd = jsonLd;

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
