import { describe, it, expect } from 'vitest';
import { negotiateCsl, normaliseDoi, importReferenceByDoi } from './references';
import type { RepositorySet } from '../ports/repositories';
import type { Reference } from '../model/types';

/** Response-like object the way `negotiateCsl` reads it. */
function res(opts: { status?: number; contentType?: string; json?: unknown }): Response {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (opts.contentType ?? null) : null) },
    json: async () => opts.json,
  } as unknown as Response;
}

describe('negotiateCsl', () => {
  it('returns the parsed CSL JSON on a valid response', async () => {
    const csl = { DOI: '10.1/x', title: 'A paper' };
    const got = await negotiateCsl('10.1/x', async () => res({ contentType: 'application/json', json: csl }));
    expect(got).toEqual(csl);
  });

  it('rejects an HTML page with a friendly error, not a raw JSON SyntaxError', async () => {
    await expect(
      negotiateCsl('10.1/x', async () =>
        res({
          contentType: 'text/html; charset=utf-8',
          json: () => {
            throw new SyntaxError('Unexpected token <');
          },
        }),
      ),
    ).rejects.toThrow(/did not resolve to citation metadata/i);
  });

  it('throws with the HTTP status on a non-ok response', async () => {
    await expect(negotiateCsl('10.1/x', async () => res({ status: 404 }))).rejects.toThrow(/404/);
  });

  it('maps an AbortError to a timeout message', async () => {
    await expect(
      negotiateCsl('10.1/x', async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    ).rejects.toThrow(/timed out/i);
  });
});

/* ---- characterization tests for the injected-seam use-case (previously untested) ---- */

function fakeRepos(existing: Reference[] = []): { repos: RepositorySet; store: Reference[] } {
  const store = [...existing];
  const repos = {
    references: {
      listByProject: async (projectId: string) => store.filter((r) => r.projectId === projectId),
      put: async (r: Reference) => {
        const i = store.findIndex((x) => x.id === r.id);
        if (i >= 0) store[i] = r;
        else store.push(r);
      },
    },
  } as unknown as RepositorySet;
  return { repos, store };
}

const deps = (fetched: unknown) => ({
  fetchCsl: async () => fetched,
  newId: () => 'ref-1',
  now: () => '2026-07-26T00:00:00.000Z',
});

describe('importReferenceByDoi', () => {
  it('rejects an empty DOI', async () => {
    const { repos } = fakeRepos();
    await expect(importReferenceByDoi(repos, { projectId: 'p1', doi: '   ' }, deps({}))).rejects.toThrow(/enter a doi/i);
  });

  it('creates a reference from fetched CSL, stamping the DOI and source', async () => {
    const { repos, store } = fakeRepos();
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: '10.1/x' }, deps({ title: 'A paper' }));
    expect(ref.source).toBe('importedByDoi');
    expect((ref.cslData as { DOI?: string }).DOI).toBe('10.1/x');
    expect(store).toHaveLength(1);
  });

  it('throws when the lookup returns no object', async () => {
    const { repos } = fakeRepos();
    await expect(
      importReferenceByDoi(repos, { projectId: 'p1', doi: '10.1/x' }, deps(undefined)),
    ).rejects.toThrow(/no metadata/i);
  });

  it('dedupes: an existing reference with the same DOI is reused, not duplicated', async () => {
    const existing: Reference = {
      id: 'existing',
      projectId: 'p1',
      cslData: { DOI: '10.1/x' },
      source: 'importedByDoi',
      usedInOutputs: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const { repos, store } = fakeRepos([existing]);
    const ref = await importReferenceByDoi(repos, { projectId: 'p1', doi: 'https://doi.org/10.1/x' }, deps({ title: 'New' }));
    expect(ref.id).toBe('existing');
    expect(store).toHaveLength(1);
  });
});

describe('normaliseDoi', () => {
  it('strips a doi.org URL and a doi: prefix', () => {
    expect(normaliseDoi('https://doi.org/10.1/x')).toBe('10.1/x');
    expect(normaliseDoi('doi:10.1/x')).toBe('10.1/x');
    expect(normaliseDoi('  10.1/x  ')).toBe('10.1/x');
  });
});
