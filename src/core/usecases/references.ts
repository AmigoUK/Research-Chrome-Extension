/**
 * Reference use-cases. `importReferenceByDoi` resolves a DOI to CSL-JSON via
 * doi.org content negotiation and stores it as a project Reference.
 *
 * The network call is injected (`ImportDeps.fetchCsl`) so the logic is unit
 * testable without hitting the network; the default implementation performs the
 * real content-negotiation request from the service worker.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Document, DocumentMetadata, Reference, Id } from '../model/types';

/** Strip a URL/`doi:` prefix and normalise a DOI for lookup. */
export function normaliseDoi(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
}

export interface ImportDeps {
  /** Fetch CSL-JSON for a normalised DOI. */
  fetchCsl: (doi: string) => Promise<unknown>;
  newId: () => string;
  now: () => string;
}

/** doi.org is usually quick; a hung request must not leave the UI waiting. */
const DOI_TIMEOUT_MS = 15_000;

/**
 * Resolve a normalised DOI to CSL-JSON via doi.org content negotiation. The
 * `fetch` is injected so the logic is unit-testable without a network. Guards a
 * hung request (timeout) and, crucially, a DOI that resolves to an HTML landing
 * page instead of metadata: without the content-type check `res.json()` throws a
 * raw `SyntaxError: Unexpected token <` that bypasses the friendly error path.
 */
export async function negotiateCsl(
  doi: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = DOI_TIMEOUT_MS,
): Promise<unknown> {
  // Without the timeout the promise never settles: the import button spins
  // forever, and the service worker cannot go to sleep while the fetch pends.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(`https://doi.org/${encodeURIComponent(doi)}`, {
      headers: { Accept: 'application/vnd.citationstyles.csl+json' },
      redirect: 'follow',
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`DOI lookup failed (${res.status})`);
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) {
      throw new Error('That DOI did not resolve to citation metadata');
    }
    return (await res.json()) as unknown;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('DOI lookup timed out — check the connection and try again');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps: ImportDeps = {
  fetchCsl: (doi: string): Promise<unknown> => negotiateCsl(doi),
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export interface ImportReferenceInput {
  projectId: Id;
  doi: string;
}

export async function importReferenceByDoi(
  repos: RepositorySet,
  input: ImportReferenceInput,
  deps: ImportDeps = defaultDeps,
): Promise<Reference> {
  const doi = normaliseDoi(input.doi);
  if (!doi) throw new Error('Enter a DOI to import');

  const fetched = await deps.fetchCsl(doi);
  const csl = (Array.isArray(fetched) ? fetched[0] : fetched) as
    Record<string, unknown> | undefined;
  if (!csl || typeof csl !== 'object') throw new Error('No metadata found for that DOI');

  // Ensure the DOI is present on the stored CSL data.
  const cslData: Record<string, unknown> = { ...csl, DOI: (csl.DOI as string | undefined) ?? doi };

  // Dedupe: if a reference with this DOI already exists in the project, reuse it.
  const existing = (await repos.references.listByProject(input.projectId)).find(
    (r) => normaliseDoi(String((r.cslData as { DOI?: string }).DOI ?? '')) === doi,
  );

  const now = deps.now();
  const reference: Reference = existing
    ? { ...existing, cslData, updatedAt: now }
    : {
        id: deps.newId(),
        projectId: input.projectId,
        cslData,
        source: 'importedByDoi',
        usedInOutputs: [],
        createdAt: now,
        updatedAt: now,
      };
  await repos.references.put(reference);
  return reference;
}

/** One CSL name → the display string our DocumentMetadata stores. */
function cslNameToString(name: unknown): string | undefined {
  if (!name || typeof name !== 'object') return undefined;
  const n = name as { family?: unknown; given?: unknown; literal?: unknown };
  if (typeof n.literal === 'string' && n.literal.trim()) return n.literal.trim();
  const family = typeof n.family === 'string' ? n.family.trim() : '';
  const given = typeof n.given === 'string' ? n.given.trim() : '';
  if (family && given) return `${family}, ${given}`;
  return family || given || undefined;
}

/** Map registry CSL-JSON onto our metadata shape. Only fields the registry
 *  actually carries are returned — the caller merges over what capture found. */
export function cslToDocumentMetadata(csl: Record<string, unknown>): Partial<DocumentMetadata> {
  const out: Partial<DocumentMetadata> = {};
  const title = Array.isArray(csl['title']) ? csl['title'][0] : csl['title'];
  if (typeof title === 'string' && title.trim()) out.title = title.trim();
  if (Array.isArray(csl['author'])) {
    const authors = csl['author'].map(cslNameToString).filter((a): a is string => !!a);
    if (authors.length) out.authors = authors;
  }
  const issued = csl['issued'] as { 'date-parts'?: unknown } | undefined;
  const year = Array.isArray(issued?.['date-parts'])
    ? (issued['date-parts'] as unknown[][])[0]?.[0]
    : undefined;
  if (typeof year === 'number' && Number.isFinite(year)) out.year = year;
  const container = Array.isArray(csl['container-title'])
    ? csl['container-title'][0]
    : csl['container-title'];
  if (typeof container === 'string' && container.trim()) out.journal = container.trim();
  if (typeof csl['publisher'] === 'string' && csl['publisher'].trim()) {
    out.publisher = csl['publisher'].trim();
  }
  if (typeof csl['volume'] === 'string' || typeof csl['volume'] === 'number') {
    out.volume = String(csl['volume']);
  }
  if (typeof csl['issue'] === 'string' || typeof csl['issue'] === 'number') {
    out.issue = String(csl['issue']);
  }
  if (typeof csl['page'] === 'string' || typeof csl['page'] === 'number') {
    out.pages = String(csl['page']);
  }
  return out;
}

export interface EnrichResult {
  document: Document;
  reference: Reference;
}

/**
 * Upgrade a captured document's metadata from the DOI registry.
 *
 * Page capture gets the DOI right on essentially every publisher, but the
 * rest of the page's tags are patchy (missing years, no volume/pages,
 * inconsistent author forms). The registry record behind that same DOI is
 * authoritative and complete — so where both exist, the registry wins, and
 * whatever the registry does not carry keeps the captured value. The linked
 * Reference gets the full CSL record, which the citation engine prefers.
 */
export async function enrichDocumentFromDoi(
  repos: RepositorySet,
  documentId: Id,
  deps: ImportDeps = defaultDeps,
): Promise<EnrichResult> {
  const document = await repos.documents.get(documentId);
  if (!document) throw new Error('That source is no longer here');
  const doi = normaliseDoi(document.metadata.doi ?? '');
  if (!doi) throw new Error('This source has no DOI to look up');

  const fetched = await deps.fetchCsl(doi);
  const csl = (Array.isArray(fetched) ? fetched[0] : fetched) as
    Record<string, unknown> | undefined;
  if (!csl || typeof csl !== 'object') throw new Error('No metadata found for that DOI');
  const cslData: Record<string, unknown> = { ...csl, DOI: (csl.DOI as string | undefined) ?? doi };

  const now = deps.now();
  const enriched: Document = {
    ...document,
    metadata: { ...document.metadata, ...cslToDocumentMetadata(cslData), doi },
    type: 'article',
    updatedAt: now,
  };
  await repos.documents.put(enriched);

  const existing = await repos.references.findByDoi(document.projectId, doi);
  const reference: Reference = existing
    ? { ...existing, cslData, documentId: existing.documentId ?? document.id, updatedAt: now }
    : {
        id: deps.newId(),
        projectId: document.projectId,
        documentId: document.id,
        cslData,
        source: 'importedByDoi',
        usedInOutputs: [],
        createdAt: now,
        updatedAt: now,
      };
  await repos.references.put(reference);

  return { document: enriched, reference };
}
