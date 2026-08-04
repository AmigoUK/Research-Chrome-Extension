/**
 * Pure bibliographic metadata extraction.
 *
 * The content script gathers primitives from the DOM (title, meta tags,
 * JSON-LD, canonical URL) and hands them here. No DOM or `chrome.*` access,
 * so this is fully unit-testable.
 */
import type { DocumentMetadata, DocumentType } from '../model/types';

/** A DOI without the resolver prefix, e.g. `10.1000/xyz`. */
const DOI_RE = /\b(10\.\d+\/[-._;()/:a-z0-9]+)\b/i;

/** Extract and normalise the first valid DOI from candidate strings. */
export function findDoi(candidates: Array<string | undefined | null>): string | undefined {
  for (const raw of candidates) {
    if (!raw) continue;
    const stripped = raw
      .trim()
      .replace(/^doi:/i, '')
      .replace(/^https?:\/\/doi\.org\//i, '');
    const match = DOI_RE.exec(stripped);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return undefined;
}

export interface RawPageMetadata {
  title?: string;
  /** Flattened `<meta name/property → content>` pairs. */
  metaTags?: Record<string, string>;
  /** Author names already split out (e.g. from citation_author tags). */
  authors?: string[];
  canonicalUrl?: string;
}

const META = {
  title: ['citation_title', 'dc.title', 'og:title'],
  doi: ['citation_doi', 'dc.identifier', 'prism.doi'],
  year: ['citation_publication_date', 'citation_date', 'dc.date', 'prism.publicationdate'],
  journal: ['citation_journal_title', 'prism.publicationname', 'og:site_name'],
  publisher: ['citation_publisher', 'dc.publisher'],
} as const;

function pick(tags: Record<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = tags[key];
    if (value?.trim()) return value.trim();
  }
  return undefined;
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(value);
  return match?.[1] ? Number(match[1]) : undefined;
}

/**
 * Hosts whose every page is a discovery surface, never a citable source.
 * Google Scholar is the canonical trap: filing its results page stores
 * "«query» - Google Scholar" as a source's title.
 */
const SEARCH_HOSTS = [/(^|\.)scholar\.google\./i, /(^|\.)duckduckgo\.com$/i, /(^|\.)bing\.com$/i];

/** Path/query shapes that mark search or listing pages on any host. */
const SEARCH_PATHS = [
  /\/search\b/i, // google.com/search, sciencedirect.com/search, semanticscholar.org/search…
  /\/action\/doSearch\b/i, // Atypon platforms (Wiley, T&F…)
  /\/action\/doBasicSearch\b/i, // JSTOR
  /^\/list\//i, // arxiv.org/list/…
];
const SEARCH_QUERY_KEYS = ['q', 'query', 'term'];

/**
 * True when the page is a search/results/listing surface rather than an
 * article. Bibliographic meta tags always win: a page that declares
 * `citation_title` or a DOI is an article whatever its URL looks like.
 */
export function isSearchPage(url: string, metaTags: Record<string, string>): boolean {
  if (metaTags['citation_title'] || metaTags['citation_doi'] || metaTags['dc.title']) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (SEARCH_HOSTS.some((h) => h.test(parsed.hostname))) return true;
  if (SEARCH_PATHS.some((p) => p.test(parsed.pathname))) return true;
  // A search query on a root path (pubmed.ncbi.nlm.nih.gov/?term=…). A ?q= on
  // a deep article path stays capturable — better a rare junk capture than a
  // blocked legitimate one.
  const queryMatches = SEARCH_QUERY_KEYS.some((k) => parsed.searchParams.has(k));
  return queryMatches && parsed.pathname === '/';
}

/** Build structured `DocumentMetadata` from raw page primitives. */
export function buildDocumentMetadata(raw: RawPageMetadata): DocumentMetadata {
  const tags = raw.metaTags ?? {};
  const doi = findDoi([tags[META.doi[0]], tags[META.doi[1]], tags[META.doi[2]], raw.canonicalUrl]);
  const metadata: DocumentMetadata = {};

  const title = pick(tags, META.title) ?? raw.title;
  if (title) metadata.title = title;
  if (raw.authors?.length) metadata.authors = raw.authors;
  const year = parseYear(pick(tags, META.year));
  if (year !== undefined) metadata.year = year;
  if (doi) metadata.doi = doi;
  const journal = pick(tags, META.journal);
  if (journal) metadata.journal = journal;
  const publisher = pick(tags, META.publisher);
  if (publisher) metadata.publisher = publisher;

  return metadata;
}

/** Guess a document type from available signals (defaults to webPage). */
export function inferDocumentType(metadata: DocumentMetadata): DocumentType {
  if (metadata.doi || metadata.journal) return 'article';
  return 'webPage';
}

/** Build minimal CSL JSON from extracted metadata, for a Reference. */
export function toCslData(metadata: DocumentMetadata, url: string): Record<string, unknown> {
  const csl: Record<string, unknown> = { type: metadata.journal ? 'article-journal' : 'webpage' };
  if (metadata.title) csl['title'] = metadata.title;
  if (metadata.authors?.length) {
    csl['author'] = metadata.authors.map((name) => ({ literal: name }));
  }
  if (metadata.year !== undefined) csl['issued'] = { 'date-parts': [[metadata.year]] };
  if (metadata.journal) csl['container-title'] = metadata.journal;
  if (metadata.publisher) csl['publisher'] = metadata.publisher;
  if (metadata.doi) csl['DOI'] = metadata.doi;
  csl['URL'] = url;
  return csl;
}
