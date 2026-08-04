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
  // Ordered best-first; the tail entries are fallbacks for publishers
  // (IngentaConnect, some society presses) that skip the Highwire dates and
  // would otherwise cite as "(n.d.)".
  year: [
    'citation_publication_date',
    'citation_date',
    'citation_online_date',
    'dc.date',
    'dc.date.issued',
    'prism.publicationdate',
    'prism.coverdate',
  ],
  // og:site_name is NOT here: it names the website, not the container —
  // mapping it to journal made arXiv captures cite "arXiv.org" as a journal.
  journal: ['citation_journal_title', 'prism.publicationname'],
  publisher: ['citation_publisher', 'dc.publisher'],
  volume: ['citation_volume', 'prism.volume'],
  issue: ['citation_issue', 'prism.number'],
  firstPage: ['citation_firstpage', 'prism.startingpage'],
  lastPage: ['citation_lastpage', 'prism.endingpage'],
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

/** A parsed personal name, or a literal for what cannot safely be split. */
export type CslName = { family: string; given: string } | { literal: string };

/** Names that are organisations, not people — splitting them corrupts them. */
const ORG_HINTS =
  /\b(university|institute|department|agency|committee|consortium|group|laboratory|centre|center|council|ministry|office|organisation|organization|society|association)\b/i;

/**
 * Parse a display name into CSL `family`/`given`.
 *
 * Stored `literal` names looked harmless but broke every citation format:
 * citeproc cannot invert ("Sobstyl, J. M."), cannot shorten to a surname for
 * in-text ("(Sobstyl et al., 2018)" came out as the full name), and sorts
 * bibliographies by first initial instead of surname. Publishers emit either
 * "Family, Given" (dc.creator, Ingenta) or "Given Family" (citation_author,
 * MDPI/APS) — both parse; organisations and single tokens stay literal.
 */
export function parseAuthorName(name: string): CslName {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return { literal: name };
  if (ORG_HINTS.test(clean)) return { literal: clean };
  const comma = clean.indexOf(',');
  if (comma > 0) {
    const family = clean.slice(0, comma).trim();
    const given = clean.slice(comma + 1).trim();
    return given ? { family, given } : { literal: family };
  }
  const parts = clean.split(' ');
  if (parts.length < 2) return { literal: clean };
  const family = parts[parts.length - 1] as string;
  return { family, given: parts.slice(0, -1).join(' ') };
}

/** A comparison key that treats "J. Argete", "Argete, J." and "J Argete" as
 *  one person — used to fold duplicate author entries from a single page. */
function authorKey(name: string): string {
  const parsed = parseAuthorName(name);
  const flat = 'literal' in parsed ? parsed.literal : `${parsed.family} ${parsed.given.charAt(0)}`;
  return flat
    .toLowerCase()
    .replace(/[.\s]+/g, ' ')
    .trim();
}

function dedupeAuthors(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = authorKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** Build structured `DocumentMetadata` from raw page primitives. */
export function buildDocumentMetadata(raw: RawPageMetadata): DocumentMetadata {
  const tags = raw.metaTags ?? {};
  const doi = findDoi([tags[META.doi[0]], tags[META.doi[1]], tags[META.doi[2]], raw.canonicalUrl]);
  const metadata: DocumentMetadata = {};

  const title = pick(tags, META.title) ?? raw.title;
  if (title) metadata.title = title;
  if (raw.authors?.length) {
    const authors = dedupeAuthors(raw.authors);
    if (authors.length) metadata.authors = authors;
  }
  const year = parseYear(pick(tags, META.year));
  if (year !== undefined) metadata.year = year;
  if (doi) metadata.doi = doi;
  const journal = pick(tags, META.journal);
  if (journal) metadata.journal = journal;
  const publisher = pick(tags, META.publisher);
  if (publisher) metadata.publisher = publisher;

  const volume = pick(tags, META.volume);
  if (volume) metadata.volume = volume;
  const issue = pick(tags, META.issue);
  if (issue) metadata.issue = issue;
  const firstPage = pick(tags, META.firstPage);
  const lastPage = pick(tags, META.lastPage);
  // "369–375" when both ends exist, the lone value otherwise — Physical
  // Review-style article numbers arrive as a firstpage with no lastpage.
  const pages =
    firstPage && lastPage && firstPage !== lastPage ? `${firstPage}–${lastPage}` : firstPage;
  if (pages) metadata.pages = pages;

  const arxivId = tags['citation_arxiv_id']?.trim();
  if (arxivId) metadata.identifiers = { ...metadata.identifiers, arxiv: arxivId };

  return metadata;
}

/** Guess a document type from available signals (defaults to webPage). */
export function inferDocumentType(metadata: DocumentMetadata): DocumentType {
  if (metadata.doi || metadata.journal || metadata.identifiers?.['arxiv']) return 'article';
  return 'webPage';
}

/** Build minimal CSL JSON from extracted metadata, for a Reference. */
export function toCslData(metadata: DocumentMetadata, url: string): Record<string, unknown> {
  const arxivId = metadata.identifiers?.['arxiv'];
  // A preprint with no journal is a generic 'article' (CSL's preprint-ish
  // type), not an 'article-journal' — and never a journal called "arXiv.org".
  const type = metadata.journal ? 'article-journal' : arxivId ? 'article' : 'webpage';
  const csl: Record<string, unknown> = { type };
  if (metadata.title) csl['title'] = metadata.title;
  if (metadata.authors?.length) {
    csl['author'] = metadata.authors.map(parseAuthorName);
  }
  if (metadata.year !== undefined) csl['issued'] = { 'date-parts': [[metadata.year]] };
  if (metadata.journal) csl['container-title'] = metadata.journal;
  if (metadata.publisher) csl['publisher'] = metadata.publisher;
  if (metadata.volume) csl['volume'] = metadata.volume;
  if (metadata.issue) csl['issue'] = metadata.issue;
  if (metadata.pages) csl['page'] = metadata.pages;
  if (arxivId && !metadata.journal) {
    csl['genre'] = 'preprint';
    csl['archive'] = 'arXiv';
    csl['number'] = arxivId;
  }
  if (metadata.doi) csl['DOI'] = metadata.doi;
  csl['URL'] = url;
  return csl;
}
