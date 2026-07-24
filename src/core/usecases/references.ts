/**
 * Reference use-cases. `importReferenceByDoi` resolves a DOI to CSL-JSON via
 * doi.org content negotiation and stores it as a project Reference.
 *
 * The network call is injected (`ImportDeps.fetchCsl`) so the logic is unit
 * testable without hitting the network; the default implementation performs the
 * real content-negotiation request from the service worker.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Reference, Id } from '../model/types';

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

const defaultDeps: ImportDeps = {
  fetchCsl: async (doi: string): Promise<unknown> => {
    // Without this the promise never settles: the import button spins forever,
    // and the service worker cannot go to sleep while the fetch is pending.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), DOI_TIMEOUT_MS);
    try {
      const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
        headers: { Accept: 'application/vnd.citationstyles.csl+json' },
        redirect: 'follow',
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`DOI lookup failed (${res.status})`);
      return (await res.json()) as unknown;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('DOI lookup timed out — check the connection and try again');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
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
  const csl = (Array.isArray(fetched) ? fetched[0] : fetched) as Record<string, unknown> | undefined;
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
