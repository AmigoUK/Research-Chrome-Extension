import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { handleRequest } from '../../src/core/router';
import { CiteJsFormatter } from '../../src/adapters/citation/citejs';
import { createFsCslLoader } from '../support/csl-loader';
import { isCustomBaseStyleId } from '../../src/core/citation/parse';
import { templateFor } from '../../src/core/citation/styles';
import type { BaseStyleSummary } from '../../src/core/usecases/base-styles';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { CitationStyle } from '../../src/core/model/types';

const NS = 'http://purl.org/net/xbiblio/csl';

/** A minimal but real CSL style: citeproc must be able to format with it. */
function cslFile(title: string, prefix: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="${NS}" class="in-text" version="1.0" demote-non-dropping-particle="never">
  <info>
    <title>${title}</title>
    <id>http://example.org/${title.toLowerCase().replace(/\\W+/g, '-')}</id>
    <category citation-format="author-date"/>
  </info>
  <macro name="author">
    <names variable="author"><name form="short"/></names>
  </macro>
  <citation>
    <layout prefix="(" suffix=")"><text macro="author"/></layout>
  </citation>
  <bibliography>
    <layout>
      <text value="${prefix}"/>
      <text macro="author"/>
      <text variable="title" prefix=" — "/>
    </layout>
  </bibliography>
</style>`;
}

let repos: RepositorySet;
let counter = 0;
const deps = {
  capture: { newId: () => `id-${++counter}`, now: () => '2026-07-24T12:00:00.000Z' },
};

/** The loader the service worker builds: imported styles come from storage. */
function loaderOver(set: () => RepositorySet): CiteJsFormatter {
  const fromAssets = createFsCslLoader();
  return new CiteJsFormatter(async (template) => {
    if (!isCustomBaseStyleId(template)) return fromAssets(template);
    return (await set().customBaseStyles.get(template))?.xml;
  });
}

const ITEM = {
  id: 'x',
  type: 'article-journal',
  title: 'A paper',
  author: [{ family: 'Oke', given: 'T. R.' }],
  issued: { 'date-parts': [[1982]] },
};

const profile = (baseStyleId: string): CitationStyle => ({
  id: 'p1',
  name: 'Imported profile',
  baseStyleId,
  userRules: {
    system: 'authorDate',
    maxAuthors: 3,
    etAlUseFirst: 1,
    nameAnd: 'symbol',
    includeDoi: false,
    doiAsUri: false,
    includeUrl: false,
    includeIssue: false,
    pagePrefix: false,
    foiTemplate: false,
    legalTemplate: false,
  },
});

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`base-styles-${counter++}`));
});

describe('importing a .csl file as a base style', () => {
  it('stores it, names it from the file, and lists it', async () => {
    const imported = await handleRequest(
      repos,
      { type: 'baseStyles/import', xml: cslFile('Journal of Testing', 'JT:') },
      deps,
    );
    expect(imported.ok).toBe(true);
    const summary = imported.ok ? (imported.data as BaseStyleSummary) : null;
    expect(summary).toMatchObject({
      id: 'custom-base:journal-of-testing',
      name: 'Journal of Testing',
      system: 'authorDate',
    });

    const listed = await handleRequest(repos, { type: 'baseStyles/list' });
    expect(listed.ok && (listed.data as BaseStyleSummary[]).map((b) => b.name)).toEqual([
      'Journal of Testing',
    ]);
  });

  it('returns an error result for a file that is not a CSL style', async () => {
    const res = await handleRequest(repos, { type: 'baseStyles/import', xml: '<html/>' }, deps);
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/not a CSL style/);
    expect(await repos.customBaseStyles.list()).toEqual([]);
  });

  it('an imported style is its own citation-js template', () => {
    expect(templateFor('custom-base:journal-of-testing')).toBe('custom-base:journal-of-testing');
    expect(templateFor('chicago-note')).toBe('chicago-notes-bibliography');
  });
});

describe('formatting through an imported base style', () => {
  it('citeproc actually uses the imported file', async () => {
    await handleRequest(
      repos,
      { type: 'baseStyles/import', xml: cslFile('Journal of Testing', 'JT:') },
      deps,
    );
    const formatter = loaderOver(() => repos);

    const text = await formatter.formatWithStyle(
      [ITEM],
      profile('custom-base:journal-of-testing'),
      'bibliography',
    );
    expect(text).toContain('JT:');
    expect(text).toContain('Oke');
  });

  it('re-importing an updated file replaces what is served', async () => {
    const formatter = loaderOver(() => repos);
    const routerDeps = { ...deps, formatter };

    await handleRequest(
      repos,
      { type: 'baseStyles/import', xml: cslFile('Journal of Testing', 'OLD:') },
      routerDeps,
    );
    const before = await formatter.formatWithStyle(
      [ITEM],
      profile('custom-base:journal-of-testing'),
      'bibliography',
    );
    expect(before).toContain('OLD:');

    await handleRequest(
      repos,
      { type: 'baseStyles/import', xml: cslFile('Journal of Testing', 'NEW:') },
      routerDeps,
    );
    const after = await formatter.formatWithStyle(
      [ITEM],
      profile('custom-base:journal-of-testing'),
      'bibliography',
    );
    expect(after).toContain('NEW:');
    expect(after).not.toContain('OLD:');
  });

  it('a profile whose base style was deleted degrades instead of throwing', async () => {
    await handleRequest(
      repos,
      { type: 'baseStyles/import', xml: cslFile('Journal of Testing', 'JT:') },
      deps,
    );
    const formatter = loaderOver(() => repos);

    const deleted = await handleRequest(
      repos,
      { type: 'baseStyles/delete', id: 'custom-base:journal-of-testing' },
      { ...deps, formatter },
    );
    expect(deleted).toEqual({ ok: true, data: null });

    // No CSL to compile against: an empty compile, and formatting still answers.
    expect(await formatter.compileStyle(profile('custom-base:journal-of-testing'))).toBe('');
    const text = await formatter.formatWithStyle(
      [ITEM],
      profile('custom-base:journal-of-testing'),
      'bibliography',
    );
    expect(typeof text).toBe('string');
  });
});
