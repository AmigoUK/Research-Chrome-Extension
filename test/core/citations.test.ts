import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import {
  formatProjectBibliography,
  formatReferenceCitation,
} from '../../src/core/usecases/citations';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { CitationFormatter, CslItem } from '../../src/core/ports/citation';
import type { Reference } from '../../src/core/model/types';

const NOW = '2026-07-23T00:00:00.000Z';

// Deterministic stub: echoes the item ids so the use-case wiring is testable
// without pinning citeproc output (that is covered by the golden test).
const stubFormatter: CitationFormatter = {
  bibliography: (items: CslItem[], template: string) =>
    `[${template}] ${items.map((i) => i['id']).join('; ')}`,
  inText: (items: CslItem[], template: string) =>
    `(${template}:${items.map((i) => i['id']).join(',')})`,
};

function makeRef(id: string, projectId: string): Reference {
  return {
    id,
    projectId,
    cslData: { type: 'article-journal', title: id },
    source: 'manual',
    usedInOutputs: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

let repos: RepositorySet;
let counter = 0;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`cite-${counter++}`));
});

describe('formatProjectBibliography', () => {
  it('formats all references in a project', async () => {
    await repos.references.put(makeRef('r1', 'p1'));
    await repos.references.put(makeRef('r2', 'p1'));
    await repos.references.put(makeRef('r3', 'p2'));

    const bib = await formatProjectBibliography(repos, stubFormatter, {
      projectId: 'p1',
      template: 'apa',
    });
    expect(bib).toBe('[apa] r1; r2');
  });

  it('returns an empty string when the project has no references', async () => {
    expect(
      await formatProjectBibliography(repos, stubFormatter, {
        projectId: 'empty',
        template: 'apa',
      }),
    ).toBe('');
  });
});

describe('formatReferenceCitation', () => {
  it('returns both in-text and bibliography forms', async () => {
    await repos.references.put(makeRef('r1', 'p1'));
    const out = await formatReferenceCitation(repos, stubFormatter, {
      referenceId: 'r1',
      template: 'harvard1',
    });
    expect(out.inText).toBe('(harvard1:r1)');
    expect(out.bibliography).toBe('[harvard1] r1');
  });

  it('throws for a missing reference', async () => {
    await expect(
      formatReferenceCitation(repos, stubFormatter, { referenceId: 'nope', template: 'apa' }),
    ).rejects.toThrow('Reference not found');
  });
});
