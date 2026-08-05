# Outline & draft export: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn collected highlights into a draft a student can paste into Word — an editable outline, a section per highlight, and an export whose citations are correct for the document as a whole.

**Architecture:** New pure core (`src/core/usecases/draft.ts` + `src/core/draft/`) behind one new message `draft/compose`, fed by one new citation-port method `formatRun` that resolves every citation in a single citeproc engine state. Surfaces (dashboard Outline route, side-panel section picker) render and assign only; they never touch storage.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest + fake-indexeddb + jsdom, Playwright, `@citation-js/core` + `@citation-js/plugin-csl` (citeproc-js), vanilla TS surfaces with a full-redraw `render()`.

**Spec:** `doc/superpowers/specs/2026-08-05-draft-bridge-design.md`

## Global Constraints

- Branch `feat/draft-bridge` off `main` (v1.7.4). Already created; the spec is committed on it.
- `src/core` stays free of `chrome.*`, IndexedDB types and DOM. `src/core/draft/` is pure string work.
- Surfaces never touch storage — they send typed messages to the worker.
- **No migration. `DB_VERSION` stays at `5`.** Every new field is optional and no index is added. Do not touch `src/adapters/idb/schema.ts`.
- Migrations `migrations[1]`–`migrations[5]`, `src/assets/csl/*.csl`, `doc/design_mock/**`, `e2e/fixtures/sample.pdf`, `dist/`, `package-lock.json` and released `CHANGELOG.md` sections are protected — do not modify.
- Escape at the sink: anything interpolated into `innerHTML` goes through `escapeHtml()`; ids in a `querySelector` go through `CSS.escape()`. citeproc output must **not** be escaped.
- Files kebab-case; types PascalCase; functions camelCase; message types `domain/verb`.
- Comments explain **why**, not what.
- Every task ends green on: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`.
- Baseline before starting: **377 unit tests, 39 E2E**, all passing.

---

### Task 1: Model fields, `resolveOutline`, snapshot validation

**Files:**
- Modify: `src/core/model/types.ts`
- Create: `src/core/draft/outline.ts`
- Create: `src/core/draft/outline.test.ts`
- Modify: `src/core/snapshot/validate.ts`
- Modify: `src/core/snapshot/validate.test.ts` (append)
- Modify: `src/sidepanel/main.ts:151`, `src/sidepanel/main.ts:1083`, `src/options/main.ts:271`, `src/core/usecases/web-annotation.ts:44` (default project sections)
- Modify: `src/options/main.ts:548` (Overview tile no longer reads `p.sections.length`)

**Interfaces:**
- Produces: `OutlineSection { id: Id; title: string }`; `Project.outline?`, `Project.researchQuestion?`, `Project.dueDate?`, `Project.sections?` (now optional); `Annotation.section?: Id`; `resolveOutline(project): OutlineSection[]`; `DEFAULT_OUTLINE_TITLES: readonly string[]`.

- [ ] **Step 1: Add the types**

In `src/core/model/types.ts`, above `export interface Project`:

```ts
/**
 * One section of the draft. The id is stable and never reused, so renaming a
 * section keeps its passages — exactly as `HighlightColor.id` does for the
 * palette. Storing a section *title* on an annotation would orphan every
 * passage on a rename and merge two sections that happened to share a name.
 */
export interface OutlineSection {
  id: Id;
  title: string;
}
```

Change `Project`:

```ts
export interface Project {
  id: Id;
  name: string;
  description?: string;
  defaultCitationStyleId?: Id;
  /** @deprecated Superseded by `outline`. Still accepted on import and derived
   *  from once by `resolveOutline`; never written again. */
  sections?: string[];
  /** Draft structure. Absent → derived by `resolveOutline`. */
  outline?: OutlineSection[];
  /** The question this project answers. Shown above the outline. */
  researchQuestion?: string;
  /** Hand-in date, `YYYY-MM-DD`. A calendar fact, not an instant: a timestamp
   *  makes "in 5 days" jump by a day across time zones. */
  dueDate?: string;
  members: ProjectMember[];
  colorPalette?: HighlightColor[];
  syncMode?: SyncMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

Add to `Annotation`, directly under `color`:

```ts
  /** `OutlineSection.id` — as `color` holds a `HighlightColor.id`. */
  section?: Id;
```

- [ ] **Step 2: Write the failing test** — create `src/core/draft/outline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveOutline, DEFAULT_OUTLINE_TITLES } from './outline';
import type { Project } from '../model/types';

const base: Project = {
  id: 'p1',
  name: 'Essay',
  members: [],
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

describe('resolveOutline', () => {
  it('returns a stored outline unchanged', () => {
    const outline = [{ id: 's1', title: 'Intro' }];
    expect(resolveOutline({ ...base, outline })).toEqual(outline);
  });

  it('derives one section per legacy title, minting ids', () => {
    const out = resolveOutline({ ...base, sections: ['Literature', 'Methods'] });
    expect(out.map((s) => s.title)).toEqual(['Literature', 'Methods']);
    expect(new Set(out.map((s) => s.id)).size).toBe(2);
    expect(out.every((s) => s.id.length > 0)).toBe(true);
  });

  it('is stable across calls, so the screen and the export agree', () => {
    const project = { ...base, sections: ['Literature', 'Methods'] };
    expect(resolveOutline(project)).toEqual(resolveOutline(project));
  });

  it('falls back to the essay-shaped defaults when there is nothing to derive from', () => {
    expect(resolveOutline(base).map((s) => s.title)).toEqual([...DEFAULT_OUTLINE_TITLES]);
  });

  it('prefers a stored outline over legacy sections', () => {
    const outline = [{ id: 's1', title: 'Intro' }];
    expect(resolveOutline({ ...base, outline, sections: ['Literature'] })).toEqual(outline);
  });

  it('ignores an empty stored outline rather than showing no sections at all', () => {
    expect(resolveOutline({ ...base, outline: [] }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/core/draft/outline.test.ts`
Expected: FAIL — `Failed to resolve import "./outline"`.

- [ ] **Step 4: Implement** — create `src/core/draft/outline.ts`:

```ts
/**
 * The single answer to "what are this project's sections".
 *
 * Used by the Outline view, the side-panel picker and `composeDraft` alike.
 * Without one shared resolver a project mid-retirement of `Project.sections`
 * would show one set of sections on screen and compose the draft against
 * another — and since section order drives citation order, that silently
 * renumbers a Vancouver draft.
 */
import type { OutlineSection, Project } from '../model/types';

/** An essay's shape, not a research report's. The target reader is an
 *  undergraduate writing to a brief. */
export const DEFAULT_OUTLINE_TITLES = [
  'Introduction',
  'Background',
  'Evidence',
  'Counter-arguments',
  'Conclusion',
] as const;

/** Deterministic id from a title and its position: the same project must
 *  resolve to the same ids on every call, or assignments made against one
 *  render would dangle on the next. A random id here would look correct in
 *  a single render and lose every assignment on reload. */
function derivedId(title: string, index: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `sec-${index}-${slug || 'section'}`;
}

function fromTitles(titles: readonly string[]): OutlineSection[] {
  return titles.map((title, i) => ({ id: derivedId(title, i), title }));
}

export function resolveOutline(project: Project): OutlineSection[] {
  if (project.outline && project.outline.length > 0) return project.outline;
  if (project.sections && project.sections.length > 0) return fromTitles(project.sections);
  return fromTitles(DEFAULT_OUTLINE_TITLES);
}
```

- [ ] **Step 5: Run and verify it passes**

Run: `npx vitest run src/core/draft/outline.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Export the new-project outline**

Add to `src/core/draft/outline.ts`:

```ts
/** The outline a brand-new project starts with. One definition, called at all
 *  four new-project sites, so the defaults cannot drift apart again — they
 *  already had four copies of the old literal. */
export function defaultOutline(): OutlineSection[] {
  return fromTitles(DEFAULT_OUTLINE_TITLES);
}
```

- [ ] **Step 7: Update the four default-project sites**

At `src/sidepanel/main.ts:151`, `src/sidepanel/main.ts:1083`, `src/options/main.ts:271` and `src/core/usecases/web-annotation.ts:44`, replace this line in the new-project literal:

```ts
    sections: ['Literature', 'Methods', 'Data', 'Report'],
```

with:

```ts
    outline: defaultOutline(),
```

Import path: `from '../draft/outline'` in `src/core/usecases/web-annotation.ts`, `from '../core/draft/outline'` in the two surface files.

- [ ] **Step 8: Fix the Overview tile**

In `src/options/main.ts:548` the tile reads `${p?.sections.length ?? 0} sections`, which no longer type-checks. Replace that sub-line with the unplaced count (the due-date half arrives in Task 10):

```ts
<div class="tsub">${state.annotations.filter((a) => !a.section).length} unplaced · ${members} member${members === 1 ? '' : 's'}</div>
```

- [ ] **Step 9: Validate the new fields on import** — in `src/core/snapshot/validate.ts`, beside the existing `sections:` line (`validate.ts:241`), accept an optional outline and keep `sections` tolerated:

```ts
      ...(project['outline'] === undefined
        ? {}
        : {
            outline: list(project['outline'], 'the outline').map((s, i) => ({
              id: id(record(s, `outline[${i}]`)['id'], `outline[${i}].id`),
              title: text(record(s, `outline[${i}]`)['title'], `outline[${i}].title`, 200),
            })),
          }),
```

Use the file's existing `list` / `record` / `id` / `text` helpers with the same argument order the neighbouring fields use; if a helper has a different name in this file, use that name — do not invent one.

For annotations, `section` must name a section **of the same project**, else the annotation is imported as unplaced rather than rejected (an import must not fail on somebody else's dangling reference). Beside the existing `color` handling:

```ts
      // A dangling section id is dropped, not rejected: a partial snapshot is a
      // normal thing to receive, and losing the whole annotation over a missing
      // heading would be a worse trade than showing it as unplaced.
      ...(sectionIds.has(String(annotation['section'])) ? { section: String(annotation['section']) } : {}),
```

where `sectionIds` is a `Set<string>` of the validated project's outline ids, built once before annotations are validated, exactly as the palette's colour ids are handled.

- [ ] **Step 10: Test the validation** — append to `src/core/snapshot/validate.test.ts`:

```ts
describe('outline and section validation', () => {
  it('keeps a well-formed outline', () => {
    const snap = validSnapshotWith({ outline: [{ id: 's1', title: 'Intro' }] });
    expect(validateSnapshot(snap).projects[0]?.outline).toEqual([{ id: 's1', title: 'Intro' }]);
  });

  it('rejects an outline entry with a bad id', () => {
    const snap = validSnapshotWith({ outline: [{ id: '<script>', title: 'Intro' }] });
    expect(() => validateSnapshot(snap)).toThrow();
  });

  it('drops an annotation section that names no section in this project', () => {
    const snap = validSnapshotWith({ outline: [{ id: 's1', title: 'Intro' }] }, { section: 's9' });
    expect(validateSnapshot(snap).annotations[0]?.section).toBeUndefined();
  });
});
```

Write `validSnapshotWith(projectPatch, annotationPatch?)` as a local helper built on whatever valid-snapshot fixture the file already uses; do not duplicate a whole snapshot literal.

- [ ] **Step 11: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green; unit count 377 → ~386.

- [ ] **Step 12: Commit**

```bash
git add src/core/model/types.ts src/core/draft/ src/core/snapshot/validate.ts src/core/snapshot/validate.test.ts src/sidepanel/main.ts src/options/main.ts src/core/usecases/web-annotation.ts
git commit -m "Give a project an outline, and a highlight a place in it"
```

---

### Task 2: `formatRun` — every citation in one engine state

**Files:**
- Modify: `src/core/ports/citation.ts`
- Modify: `src/adapters/citation/citejs.ts`
- Modify: `test/core/citations.test.ts` (the stub formatter at line 19 gains the method)
- Create: `test/adapters/citation-run.test.ts`

**Interfaces:**
- Consumes: `templateFor`, `compileCsl`, `applyRulesToItem`, `applyDoiFormat` (already imported by `citejs.ts`).
- Produces: `CitationRun { items: CslItem[]; order: Id[] }`, `CitationRunOutput { inText: string[]; bibliography: string }`, `CitationFormatter.formatRun(run, template, flavour, style?)`.

- [ ] **Step 1: Extend the port** — append to `src/core/ports/citation.ts`:

```ts
/** A whole document's citing, resolved in a single engine state. */
export interface CitationRun {
  items: CslItem[];
  /** Item ids in the order they are cited in the draft. Repeats allowed. */
  order: string[];
}

export interface CitationRunOutput {
  /** One citation per position in `order` — same length, same order. */
  inText: string[];
  /** The reference list, in the order the style dictates. */
  bibliography: string;
}
```

and add to the `CitationFormatter` interface:

```ts
  /**
   * Format every citation of one draft against a single engine state.
   *
   * Necessary, not merely tidier: `.format('citation')` renders one cluster,
   * so per-source calls give every source `(1)` under a numeric style; and
   * citeproc disambiguates retroactively, so a cluster formatted without the
   * clusters that follow it can say "(Nowak 2016)" where the finished document
   * says "(Nowak 2016a)".
   *
   * `flavour: 'html'` keeps the italics a word processor needs.
   */
  formatRun(
    run: CitationRun,
    template: string,
    flavour: 'text' | 'html',
    style?: CitationStyle,
  ): Promise<CitationRunOutput>;
```

- [ ] **Step 2: Write the failing golden tests** — create `test/adapters/citation-run.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { CiteJsFormatter } from '../../src/adapters/citation/citejs';
import { templateFor } from '../../src/core/citation/styles';

/** Load a vendored CSL the way the worker does — from disk, not inlined. */
const loader = (name: string): Promise<string | undefined> =>
  readFile(new URL(`../../src/assets/csl/${name}.csl`, import.meta.url), 'utf8').catch(
    () => undefined,
  );

const items = [
  {
    id: 'A', type: 'article-journal', title: 'Adoption barriers',
    'container-title': 'Agronomy', volume: '8', issue: '3', page: '150-161',
    issued: { 'date-parts': [[2016]] },
    author: [{ family: 'Nowak', given: 'Anna' }, { family: 'Kowalski', given: 'Bartosz' }],
  },
  {
    id: 'B', type: 'article-journal', title: 'Precision farming uptake',
    'container-title': 'Field Crops', volume: '12', page: '1-14',
    issued: { 'date-parts': [[2016]] },
    author: [{ family: 'Nowak', given: 'Anna' }, { family: 'Kowalski', given: 'Bartosz' }],
  },
  {
    id: 'C', type: 'article-journal', title: 'Subsidy effects',
    'container-title': 'Land Use Policy', volume: '99', page: '40-52',
    issued: { 'date-parts': [[2020]] },
    author: [{ family: 'Lis', given: 'Cezary' }],
  },
];

/** Cited order of a real draft: C first, then A, then B, then A again. */
const order = ['C', 'A', 'B', 'A'];

// citeproc compiles a style on first use; these suites are slower than a unit
// test and have gone flaky at the default timeout under parallel load.
describe('formatRun', { timeout: 30_000 }, () => {
  let formatter: CiteJsFormatter;
  beforeAll(() => {
    formatter = new CiteJsFormatter(loader);
  });

  it('numbers a Vancouver draft in citation order, and the bibliography agrees', async () => {
    const out = await formatter.formatRun(
      { items, order },
      templateFor('vancouver'),
      'text',
    );

    // Assert the CORRESPONDENCE, not the strings: separate assertions would
    // both pass while the in-text numbers pointed at the wrong entries.
    const numbers = out.inText.map((c) => Number(c.replace(/\D/g, '')));
    expect(numbers).toEqual([1, 2, 3, 2]);

    const lines = out.bibliography.split('\n').filter((l) => l.trim().length > 0);
    const titleAt = (n: number): string => lines[n - 1] ?? '';
    expect(titleAt(numbers[0]!)).toContain('Subsidy effects');   // C
    expect(titleAt(numbers[1]!)).toContain('Adoption barriers'); // A
    expect(titleAt(numbers[2]!)).toContain('Precision farming'); // B
  });

  it('disambiguates the FIRST occurrence too, not only the later one', async () => {
    // With `citationsPre` alone this returns "(Nowak and Kowalski 2016)" for the
    // first A and "2016a" for the last — the same source cited two ways.
    const out = await formatter.formatRun(
      { items, order },
      templateFor('harvard-solent'),
      'text',
    );
    expect(out.inText[1]).toContain('2016a');
    expect(out.inText[2]).toContain('2016b');
  });

  it('renders a repeated source identically wherever it appears', async () => {
    const out = await formatter.formatRun({ items, order }, templateFor('apa'), 'text');
    expect(out.inText[3]).toBe(out.inText[1]);
  });

  it('emits italics in the html flavour, so a paste into a word processor keeps them', async () => {
    const out = await formatter.formatRun({ items, order }, templateFor('apa'), 'html');
    expect(out.bibliography).toContain('<i>');
  });

  it('cites only what the draft uses', async () => {
    const out = await formatter.formatRun(
      { items, order: ['C'] },
      templateFor('apa'),
      'text',
    );
    expect(out.inText).toHaveLength(1);
    expect(out.bibliography).toContain('Subsidy effects');
    expect(out.bibliography).not.toContain('Adoption barriers');
  });

  it('returns nothing to cite for an empty draft', async () => {
    const out = await formatter.formatRun({ items, order: [] }, templateFor('apa'), 'text');
    expect(out.inText).toEqual([]);
    expect(out.bibliography).toBe('');
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run test/adapters/citation-run.test.ts`
Expected: FAIL — `formatter.formatRun is not a function`.

- [ ] **Step 4: Implement in the adapter** — add to `CiteJsFormatter` in `src/adapters/citation/citejs.ts`:

```ts
  async formatRun(
    run: CitationRun,
    template: string,
    flavour: 'text' | 'html',
    style?: CitationStyle,
  ): Promise<CitationRunOutput> {
    if (run.order.length === 0) return { inText: [], bibliography: '' };

    // Resolve the template exactly as the other methods do, so a user's
    // compiled rules apply here too.
    const name = style
      ? await this.styleTemplate(style)
      : (await this.ensureTemplate(template)).template;
    const rules = style?.userRules;
    const processed = run.items.map((item) => (rules ? applyRulesToItem(item, rules) : item));

    // Only the sources the draft actually cites, ordered by FIRST citation:
    // Vancouver numbers its reference list that way, and a bibliography built
    // on input order would disagree with the numbers in the text. Author-date
    // styles sort themselves, so this ordering is a no-op for them.
    const firstCited = [...new Set(run.order)];
    const byId = new Map(processed.map((i) => [String((i as { id?: unknown }).id), i]));
    const cited = firstCited.map((id) => byId.get(id)).filter((i): i is CslItem => i !== undefined);

    const cite = new Cite(processed);
    const inText = run.order.map((id, i) =>
      cite
        .format('citation', {
          format: flavour,
          template: name,
          lang: 'en-US',
          entry: [id],
          // Both sides, not just `citationsPre`: citeproc disambiguates
          // retroactively, so a cluster that cannot see the ones after it
          // freezes an answer that stops being true further down the draft.
          citationsPre: run.order.slice(0, i).map((p) => [p]),
          citationsPost: run.order.slice(i + 1).map((p) => [p]),
        })
        .trim(),
    );

    const bibliography = new Cite(cited)
      .format('bibliography', { format: flavour, template: name, lang: 'en-US' })
      .trim();

    return {
      inText: rules ? inText.map((t) => applyDoiFormat(t, rules)) : inText,
      bibliography: rules ? applyDoiFormat(bibliography, rules) : bibliography,
    };
  }
```

`styleTemplate(style)` does not exist yet — `formatWithStyle` currently inlines that logic. Extract it: move the block in `formatWithStyle` that computes `compiled`, registers `custom:${hash(...)}` and returns the template name into a new private method

```ts
  private async styleTemplate(style: CitationStyle): Promise<string> {
```

and have `formatWithStyle` call it. This is a pure extraction — `formatWithStyle`'s behaviour must not change, and its existing tests must stay green without edits.

Add `CitationRun` and `CitationRunOutput` to the type import at the top of `citejs.ts`.

- [ ] **Step 5: Run and verify**

Run: `npx vitest run test/adapters/citation-run.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Teach the stub formatter the new method** — in `test/core/citations.test.ts`, add to the `stubFormatter` object at line 19:

```ts
  formatRun: (run) =>
    Promise.resolve({
      inText: run.order.map((id) => `(${id})`),
      bibliography: [...new Set(run.order)].map((id) => `BIB ${id}`).join('\n'),
    }),
```

- [ ] **Step 7: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm run format && npm test`
Expected: green.

```bash
git add src/core/ports/citation.ts src/adapters/citation/citejs.ts test/adapters/citation-run.test.ts test/core/citations.test.ts
git commit -m "Cite a draft as one document, so Vancouver's numbers mean something"
```

---

### Task 3: `composeDraft`

**Files:**
- Create: `src/core/usecases/draft.ts`
- Create: `test/core/draft.test.ts`

**Interfaces:**
- Consumes: `resolveOutline` (Task 1); `CitationFormatter.formatRun` (Task 2); `RepositorySet`.
- Produces: `DraftEntry`, `DraftSection`, `Draft`, `composeDraft(repos, formatter, args)`, `orderedEntries(annotations, outline)`.

- [ ] **Step 1: Write the failing tests** — create `test/core/draft.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { composeDraft } from '../../src/core/usecases/draft';
import type { CitationFormatter } from '../../src/core/ports/citation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { Annotation, Document, Project, Reference } from '../../src/core/model/types';

const NOW = '2026-08-05T00:00:00.000Z';
const at = (min: number): string => new Date(Date.UTC(2026, 7, 5, 0, min)).toISOString();

/** Deterministic stand-in: the real citeproc is covered in citation-run.test.ts. */
const formatter = {
  formatRun: (run) =>
    Promise.resolve({
      inText: run.order.map((id) => `(${id})`),
      bibliography: [...new Set(run.order)].map((id) => `BIB ${id}`).join('\n'),
    }),
} as unknown as CitationFormatter;

let repos: RepositorySet;
let counter = 0;

const project: Project = {
  id: 'p1', name: 'Essay', members: [], createdAt: NOW, updatedAt: NOW,
  outline: [
    { id: 's1', title: 'Introduction' },
    { id: 's2', title: 'Evidence' },
  ],
  researchQuestion: 'Did subsidies increase adoption?',
};

function doc(id: string): Document {
  return {
    id, projectId: 'p1', url: `https://example.org/${id}`, type: 'article',
    metadata: { title: `Doc ${id}`, authors: ['Nowak, Anna'], year: 2016 },
    status: 'toRead', createdAt: NOW, updatedAt: NOW,
  };
}
function ref(id: string, documentId: string): Reference {
  return {
    id, projectId: 'p1', documentId, cslData: { title: `Doc ${documentId}` },
    source: 'extractedFromPage', usedInOutputs: [], createdAt: NOW, updatedAt: NOW,
  };
}
function anno(id: string, documentId: string, patch: Partial<Annotation> = {}): Annotation {
  return {
    id, projectId: 'p1', documentId,
    anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: `quote ${id}` }] },
    content: `note ${id}`, tags: [], status: 'open', author: 'u1',
    createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`draft-${counter++}`));
  await repos.projects.put(project);
});

const compose = () =>
  composeDraft(repos, formatter, { projectId: 'p1', template: 'apa', flavour: 'text' });

describe('composeDraft', () => {
  it('groups passages under their section and leaves the rest unplaced', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));
    await repos.annotations.put(anno('a2', 'd1', { section: 's2' }));
    await repos.annotations.put(anno('a3', 'd1'));

    const draft = await compose();
    expect(draft.sections.map((s) => s.title)).toEqual(['Introduction', 'Evidence']);
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a3']);
    expect(draft.researchQuestion).toBe('Did subsidies increase adoption?');
  });

  it('orders passages within a section by when they were made', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('late', 'd1', { section: 's1', createdAt: at(30) }));
    await repos.annotations.put(anno('early', 'd1', { section: 's1', createdAt: at(10) }));

    const draft = await compose();
    expect(draft.sections[0]?.entries.map((e) => e.annotationId)).toEqual(['early', 'late']);
  });

  it('cites in section order, so the citation order follows the argument', async () => {
    await repos.documents.put(doc('d1'));
    await repos.documents.put(doc('d2'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.references.put(ref('r2', 'd2'));
    await repos.annotations.put(anno('a1', 'd2', { section: 's1' }));
    await repos.annotations.put(anno('a2', 'd1', { section: 's2' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.inTextFormatted).toBe('(r2)');
    expect(draft.sections[1]?.entries[0]?.inTextFormatted).toBe('(r1)');
  });

  it('takes the quote from the anchor', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.quote).toBe('quote a1');
    expect(draft.sections[0]?.entries[0]?.note).toBe('note a1');
  });

  it('keeps a dragged PDF region that has no quote, with its page', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(
      anno('a1', 'd1', {
        section: 's1',
        anchor: { kind: 'pdf', selectors: [{ type: 'pdfRegion', page: 4, rects: [] }] },
      }),
    );

    const draft = await compose();
    const entry = draft.sections[0]?.entries[0];
    expect(entry?.quote).toBeUndefined();
    expect(entry?.locator).toBe('PDF p. 4');
  });

  it('keeps a passage whose document has no reference, and counts it', async () => {
    await repos.documents.put(doc('d1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 's1' }));

    const draft = await compose();
    expect(draft.sections[0]?.entries[0]?.missingReference).toBe(true);
    expect(draft.missingReferenceCount).toBe(1);
  });

  it('groups by colour when nothing has been assigned', async () => {
    await repos.projects.put({
      ...project,
      colorPalette: [
        { id: 'c1', swatch: '#ffcc00', label: 'Evidence' },
        { id: 'c2', swatch: '#ff0000', label: 'Disagree' },
      ],
    });
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { color: 'c1' }));
    await repos.annotations.put(anno('a2', 'd1', { color: 'c2' }));

    const draft = await compose();
    expect(draft.groupedByColour).toBe(true);
    expect(draft.sections.map((s) => s.title)).toEqual(['Evidence', 'Disagree']);
    expect(draft.unplaced).toEqual([]);
  });

  it('treats a section id that names no section as unplaced', async () => {
    await repos.documents.put(doc('d1'));
    await repos.references.put(ref('r1', 'd1'));
    await repos.annotations.put(anno('a1', 'd1', { section: 'deleted-section' }));

    const draft = await compose();
    expect(draft.unplaced.map((e) => e.annotationId)).toEqual(['a1']);
    expect(draft.groupedByColour).toBe(false);
  });

  it('returns an empty draft rather than throwing when there is nothing collected', async () => {
    const draft = await compose();
    expect(draft.sections.every((s) => s.entries.length === 0)).toBe(true);
    expect(draft.bibliography).toBe('');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/core/draft.test.ts`
Expected: FAIL — cannot resolve `src/core/usecases/draft`.

- [ ] **Step 3: Implement** — create `src/core/usecases/draft.ts`:

```ts
/**
 * Compose a project's highlights into a draft: sections in outline order,
 * passages in the order they were made, every citation resolved against the
 * draft as a whole.
 *
 * Returns a STRUCTURE, not a string. Rendering to HTML and to Markdown are two
 * views of one model, and a service worker has no `DOMParser` — deriving one
 * from the other would mean hand-writing an HTML parser.
 */
import type { RepositorySet } from '../ports/repositories';
import type { CitationFormatter } from '../ports/citation';
import type {
  Annotation,
  CitationStyle,
  Document,
  Id,
  OutlineSection,
  Reference,
} from '../model/types';
import { DEFAULT_HIGHLIGHT_COLORS } from '../model/types';
import { resolveOutline } from '../draft/outline';

export interface DraftEntry {
  annotationId: Id;
  /** The quoted passage. Absent for a dragged PDF region — coordinates, not text. */
  quote?: string;
  /** The student's own words. May be empty. */
  note: string;
  /** Rendered by citeproc in the requested flavour, already correct for the
   *  whole draft. Never escape it: in `html` that kills the italics, and in
   *  `text` it is not user input in the first place. */
  inTextFormatted: string;
  /** Palette label, so the taxonomy survives into the draft. */
  colorLabel?: string;
  /** Where in the source. Labelled "PDF p. N" and never presented as a printed
   *  page: a file page is not the journal's page, and a confident wrong page
   *  would go into submitted work. */
  locator?: string;
  /** This passage's document has no Reference — nothing to cite it with. */
  missingReference?: boolean;
}

export interface DraftSection {
  id: Id;
  title: string;
  entries: DraftEntry[];
}

export interface Draft {
  projectName: string;
  researchQuestion?: string;
  dueDate?: string;
  sections: DraftSection[];
  /** Passages with no section. Rendered last, under their own heading. */
  unplaced: DraftEntry[];
  bibliography: string;
  /** Nothing was assigned, so sections are colour labels, not an outline. */
  groupedByColour: boolean;
  missingReferenceCount: number;
}

/** Quote text, if the anchor carries any. */
function quoteOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind === 'web') {
    for (const selector of anchor.selectors) {
      if (selector.type === 'textQuote' && selector.exact) return selector.exact;
    }
    return undefined;
  }
  return anchor.selectors[0]?.quote;
}

function locatorOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind !== 'pdf') return undefined;
  const page = anchor.selectors[0]?.page;
  return page === undefined ? undefined : `PDF p. ${page}`;
}

/** Passages of one bucket, oldest first. Exported because the Outline view must
 *  sort identically: this order becomes the citation order, so a difference
 *  between the screen and the export would renumber a Vancouver draft. */
export function orderedEntries(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function composeDraft(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { projectId: Id; template: string; flavour: 'text' | 'html'; style?: CitationStyle },
): Promise<Draft> {
  const project = await repos.projects.get(args.projectId);
  if (!project) throw new Error(`Project not found: ${args.projectId}`);

  const [annotations, documents, references] = await Promise.all([
    repos.annotations.listByProject(args.projectId),
    repos.documents.listByProject(args.projectId),
    repos.references.listByProject(args.projectId),
  ]);

  const outline = resolveOutline(project);
  const sectionIds = new Set(outline.map((s) => s.id));
  const palette = project.colorPalette ?? DEFAULT_HIGHLIGHT_COLORS;
  const refByDocument = new Map<Id, Reference>();
  for (const reference of references) {
    if (reference.documentId) refByDocument.set(reference.documentId, reference);
  }

  const placed = annotations.filter((a) => a.section && sectionIds.has(a.section));
  const groupedByColour = placed.length === 0 && annotations.length > 0;

  // Buckets in render order — this is what fixes the citation order.
  const buckets: Array<{ id: Id; title: string; items: Annotation[] }> = groupedByColour
    ? palette
        .map((c) => ({
          id: c.id,
          title: c.label,
          items: orderedEntries(annotations.filter((a) => a.color === c.id)),
        }))
        .filter((b) => b.items.length > 0)
    : outline.map((s) => ({
        id: s.id,
        title: s.title,
        items: orderedEntries(placed.filter((a) => a.section === s.id)),
      }));

  const unplacedItems = groupedByColour
    ? orderedEntries(annotations.filter((a) => !a.color))
    : orderedEntries(annotations.filter((a) => !a.section || !sectionIds.has(a.section)));

  // Flatten in exactly the order the draft reads, then cite once against it.
  const flat = [...buckets.flatMap((b) => b.items), ...unplacedItems];
  const order: Id[] = [];
  for (const annotation of flat) {
    const reference = refByDocument.get(annotation.documentId);
    if (reference) order.push(reference.id);
  }

  const run =
    order.length > 0
      ? await formatter.formatRun(
          { items: references.map((r) => ({ ...r.cslData, id: r.id })), order },
          args.template,
          args.flavour,
          args.style,
        )
      : { inText: [], bibliography: '' };

  // Walk the flat list once more, consuming citations in the same order.
  let cursor = 0;
  let missingReferenceCount = 0;
  const entryFor = (annotation: Annotation): DraftEntry => {
    const reference = refByDocument.get(annotation.documentId);
    const quote = quoteOf(annotation);
    const locator = locatorOf(annotation);
    const colorLabel = palette.find((c) => c.id === annotation.color)?.label;
    if (!reference) missingReferenceCount += 1;
    return {
      annotationId: annotation.id,
      note: annotation.content,
      inTextFormatted: reference ? (run.inText[cursor++] ?? '') : '',
      ...(quote === undefined ? {} : { quote }),
      ...(locator === undefined ? {} : { locator }),
      ...(colorLabel === undefined ? {} : { colorLabel }),
      ...(reference ? {} : { missingReference: true as const }),
    };
  };

  const sections = buckets.map((b) => ({
    id: b.id,
    title: b.title,
    entries: b.items.map(entryFor),
  }));
  const unplaced = unplacedItems.map(entryFor);

  return {
    projectName: project.name,
    ...(project.researchQuestion === undefined
      ? {}
      : { researchQuestion: project.researchQuestion }),
    ...(project.dueDate === undefined ? {} : { dueDate: project.dueDate }),
    sections,
    unplaced,
    bibliography: run.bibliography,
    groupedByColour,
    missingReferenceCount,
  };
}
```

Note the unused `Document` import must be removed if the final file does not use it — `npm run lint` will say so.

- [ ] **Step 4: Run and verify**

Run: `npx vitest run test/core/draft.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm run format && npm test`

```bash
git add src/core/usecases/draft.ts test/core/draft.test.ts
git commit -m "Compose collected passages into a draft, cited as one document"
```

---

### Task 4: Serialisers — HTML for the clipboard, Markdown for the file

**Files:**
- Create: `src/core/text/escape.ts`
- Modify: `src/options/view-model.ts:71` (re-export instead of a second copy)
- Create: `src/core/draft/serialise.ts`
- Create: `src/core/draft/serialise.test.ts`

**Interfaces:**
- Consumes: `Draft`, `DraftEntry`, `DraftSection` (Task 3).
- Produces: `escapeHtml(value: unknown): string` from `src/core/text/escape.ts`; `draftToHtml(draft: Draft): string`; `draftToMarkdown(draft: Draft): string`.

- [ ] **Step 1: Move `escapeHtml` into the core**

Create `src/core/text/escape.ts` holding the exact body currently at `src/options/view-model.ts:71`, with its doc comment. In `src/options/view-model.ts`, delete the function and re-export so its six existing call sites keep working untouched:

```ts
export { escapeHtml } from '../core/text/escape';
```

The core cannot import from a surface, and `draftToHtml` needs this — one copy in the core is better than two implementations drifting apart.

- [ ] **Step 2: Write the failing tests** — create `src/core/draft/serialise.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { draftToHtml, draftToMarkdown } from './serialise';
import type { Draft } from '../usecases/draft';

const draft: Draft = {
  projectName: 'Essay',
  researchQuestion: 'Did subsidies increase adoption?',
  dueDate: '2026-08-10',
  sections: [
    {
      id: 's1',
      title: 'Barriers',
      entries: [
        {
          annotationId: 'a1',
          quote: 'Farmers cited upfront cost.',
          note: 'contradicts Kowalski',
          inTextFormatted: '(Nowak &#38; Kowalski, 2016a)',
          colorLabel: 'Evidence',
        },
      ],
    },
  ],
  unplaced: [],
  bibliography: '<div class="csl-entry">Nowak, A. (2016a). <i>Agronomy</i>.</div>',
  groupedByColour: false,
  missingReferenceCount: 0,
};

describe('draftToHtml', () => {
  // One test, because it is ONE decision: quote and note are text from
  // arbitrary web pages and must be escaped; citeproc output is markup and
  // must not be. Getting these two backwards is how the injection bug and the
  // "why is my bibliography full of &lt;i&gt;" bug both happen.
  it('escapes what came from a page and leaves citeproc markup alone', () => {
    const hostile: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers <script>',
          entries: [
            {
              annotationId: 'a1',
              quote: '<script>alert(1)</script> & more',
              note: 'me & you',
              inTextFormatted: '(Nowak, 2016)',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(hostile);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
    expect(html).toContain('<i>Agronomy</i>'); // bibliography survives intact
  });

  it('keeps the research question and the section heading', () => {
    const html = draftToHtml(draft);
    expect(html).toContain('Did subsidies increase adoption?');
    expect(html).toContain('Barriers');
  });

  it('puts the citation with its quote', () => {
    expect(draftToHtml(draft)).toContain('(Nowak &#38; Kowalski, 2016a)');
  });

  it('marks a direct quote that has no trustworthy page', () => {
    const pdf: Draft = {
      ...draft,
      sections: [
        {
          id: 's1',
          title: 'Barriers',
          entries: [
            {
              annotationId: 'a1', quote: 'A quoted line.', note: '',
              inTextFormatted: '(Nowak, 2016)', locator: 'PDF p. 4',
            },
          ],
        },
      ],
    };
    const html = draftToHtml(pdf);
    expect(html).toContain('[page?]');
    expect(html).toContain('PDF p. 4');
  });

  it('keeps a passage with no citation data and says so', () => {
    const orphan: Draft = {
      ...draft,
      missingReferenceCount: 1,
      sections: [
        {
          id: 's1', title: 'Barriers',
          entries: [
            { annotationId: 'a1', note: 'my thought', inTextFormatted: '', missingReference: true },
          ],
        },
      ],
    };
    expect(draftToHtml(orphan)).toContain('no bibliographic data');
  });

  it('renders unplaced passages last, under their own heading', () => {
    const html = draftToHtml({
      ...draft,
      unplaced: [{ annotationId: 'u1', note: 'stray', inTextFormatted: '(N, 2016)' }],
    });
    expect(html).toContain('Unplaced');
    expect(html.indexOf('Unplaced')).toBeGreaterThan(html.indexOf('Barriers'));
  });

  it('omits the unplaced heading entirely when nothing is unplaced', () => {
    expect(draftToHtml(draft)).not.toContain('Unplaced');
  });
});

describe('draftToMarkdown', () => {
  it('quotes with a blockquote and keeps the citation on the same line', () => {
    const md = draftToMarkdown(draft);
    expect(md).toContain('## Barriers');
    expect(md).toContain('> Farmers cited upfront cost. (Nowak &#38; Kowalski, 2016a)');
  });

  it('does not escape — Markdown is not HTML', () => {
    const md = draftToMarkdown({
      ...draft,
      sections: [
        {
          id: 's1', title: 'T',
          entries: [{ annotationId: 'a1', quote: 'a & b', note: '', inTextFormatted: '' }],
        },
      ],
    });
    expect(md).toContain('a & b');
    expect(md).not.toContain('&amp;');
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/core/draft/serialise.test.ts`
Expected: FAIL — cannot resolve `./serialise`.

- [ ] **Step 4: Implement** — create `src/core/draft/serialise.ts`:

```ts
/**
 * Two renderings of one `Draft`.
 *
 * The escaping rule is the whole point of this file: `quote` and `note` are
 * text captured from arbitrary web pages and MUST be escaped; `inTextFormatted`
 * and `bibliography` come from citeproc and MUST NOT be, or the italics a word
 * processor needs die on the way to the clipboard. The field names carry the
 * distinction so a mistake is visible at the point of use.
 */
import type { Draft, DraftEntry } from '../usecases/draft';
import { escapeHtml } from '../text/escape';

const NO_REFERENCE = 'no bibliographic data — complete it in Documents';
const NO_TEXT = 'region — no text captured';
/** A direct quote needs a page, and a PDF's file page is not the printed page.
 *  A visible gap is better than a confident wrong citation in submitted work. */
const PAGE_PLACEHOLDER = '[page?]';

function citationHtml(entry: DraftEntry): string {
  if (entry.missingReference) return ` <em>&lt;${escapeHtml(NO_REFERENCE)}&gt;</em>`;
  if (!entry.inTextFormatted) return '';
  const page = entry.quote ? ` ${escapeHtml(PAGE_PLACEHOLDER)}` : '';
  const where = entry.locator ? ` <em>&lt;${escapeHtml(entry.locator)}&gt;</em>` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

function entryHtml(entry: DraftEntry): string {
  const body = entry.quote
    ? `<blockquote><p>${escapeHtml(entry.quote)}${citationHtml(entry)}</p></blockquote>`
    : `<p><em>&lt;${escapeHtml(NO_TEXT)}${entry.locator ? `, ${escapeHtml(entry.locator)}` : ''}&gt;</em>${citationHtml(entry)}</p>`;
  const note = entry.note ? `<p><em>My note:</em> ${escapeHtml(entry.note)}</p>` : '';
  return body + note;
}

export function draftToHtml(draft: Draft): string {
  const head = [
    `<h1>${escapeHtml(draft.projectName)}</h1>`,
    draft.researchQuestion ? `<p><strong>${escapeHtml(draft.researchQuestion)}</strong></p>` : '',
    draft.groupedByColour
      ? '<p><em>No outline yet — passages are grouped by highlight colour.</em></p>'
      : '',
  ].join('');

  const body = draft.sections
    .filter((s) => s.entries.length > 0)
    .map((s) => `<h2>${escapeHtml(s.title)}</h2>${s.entries.map(entryHtml).join('')}`)
    .join('');

  const unplaced =
    draft.unplaced.length > 0
      ? `<h2>Unplaced</h2>${draft.unplaced.map(entryHtml).join('')}`
      : '';

  // citeproc's own markup, used as-is — escaping it would print the tags.
  const bibliography = draft.bibliography
    ? `<h2>References</h2>${draft.bibliography}`
    : '';

  return head + body + unplaced + bibliography;
}

function citationText(entry: DraftEntry): string {
  if (entry.missingReference) return ` <${NO_REFERENCE}>`;
  if (!entry.inTextFormatted) return '';
  const page = entry.quote ? ` ${PAGE_PLACEHOLDER}` : '';
  const where = entry.locator ? ` <${entry.locator}>` : '';
  return ` ${entry.inTextFormatted}${page}${where}`;
}

function entryMarkdown(entry: DraftEntry): string {
  const body = entry.quote
    ? `> ${entry.quote}${citationText(entry)}`
    : `<${NO_TEXT}${entry.locator ? `, ${entry.locator}` : ''}>${citationText(entry)}`;
  const note = entry.note ? `\n\n*My note:* ${entry.note}` : '';
  return `${body}${note}\n`;
}

export function draftToMarkdown(draft: Draft): string {
  const parts: string[] = [`# ${draft.projectName}`];
  if (draft.researchQuestion) parts.push(`**${draft.researchQuestion}**`);
  if (draft.dueDate) parts.push(`Due: ${draft.dueDate}`);
  if (draft.groupedByColour) {
    parts.push('_No outline yet — passages are grouped by highlight colour._');
  }
  for (const section of draft.sections) {
    if (section.entries.length === 0) continue;
    parts.push(`## ${section.title}`, ...section.entries.map(entryMarkdown));
  }
  if (draft.unplaced.length > 0) {
    parts.push('## Unplaced', ...draft.unplaced.map(entryMarkdown));
  }
  if (draft.bibliography) parts.push('## References', draft.bibliography);
  return parts.join('\n\n');
}
```

- [ ] **Step 5: Run and verify**

Run: `npx vitest run src/core/draft/serialise.test.ts`
Expected: PASS, 8 tests. Also run `npx vitest run src/options/view-model.test.ts` to confirm the `escapeHtml` move broke nothing.

- [ ] **Step 6: Full gate and commit**

```bash
git add src/core/text/ src/core/draft/serialise.ts src/core/draft/serialise.test.ts src/options/view-model.ts
git commit -m "Render a draft twice: markup for the clipboard, Markdown for the file"
```

---

### Task 5: The `draft/compose` message

**Files:**
- Modify: `src/core/messages.ts`
- Modify: `src/core/router.ts`
- Modify: `src/adapters/chrome/messaging.ts` (`mutatesData` classification)
- Modify: `test/adapters/messaging.test.ts` (append)

**Interfaces:**
- Consumes: `composeDraft` (Task 3); `resolveStyle`, `requireFormatter` (already in `router.ts`).
- Produces: message `draft/compose` with `req { projectId: Id; template: string; flavour: 'text' | 'html'; styleId?: Id }` and `res Draft`.

- [ ] **Step 1: Declare the message** — in `src/core/messages.ts`, import the type and add the entry beside the other `citations/*` entries:

```ts
import type { Draft } from './usecases/draft';
```

```ts
  'draft/compose': {
    req: { projectId: Id; template: string; flavour: 'text' | 'html'; styleId?: Id | undefined };
    res: Draft;
  };
```

- [ ] **Step 2: Route it** — in `src/core/router.ts`, import `composeDraft` and add the case beside `citations/bibliography`:

```ts
      case 'draft/compose':
        return ok(
          await composeDraft(repos, requireFormatter(deps), {
            projectId: request.projectId,
            template: request.template,
            flavour: request.flavour,
            style: await resolveStyle(repos, request.styleId),
          }),
        ) as Result;
```

`composeDraft`'s `style` parameter is optional under `exactOptionalPropertyTypes`, so pass it only when defined if the compiler objects:

```ts
        const style = await resolveStyle(repos, request.styleId);
        return ok(
          await composeDraft(repos, requireFormatter(deps), {
            projectId: request.projectId,
            template: request.template,
            flavour: request.flavour,
            ...(style === undefined ? {} : { style }),
          }),
        ) as Result;
```

- [ ] **Step 3: Write the failing test** — append to `test/adapters/messaging.test.ts`, inside the existing `data-changed broadcast` describe's sibling scope:

```ts
describe('draft/compose', () => {
  it('is a read: composing a draft must not announce a data change', async () => {
    expect(mutatesData('draft/compose')).toBe(false);
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `npx vitest run test/adapters/messaging.test.ts`
Expected: FAIL if `mutatesData` classifies by prefix and `draft/` is unclassified, or PASS immediately if the family rules already default to non-mutating. If it passes, keep the test — it pins the classification against a future edit.

- [ ] **Step 5: Classify if needed**

Inspect `mutatesData` in `src/adapters/chrome/messaging.ts`. `draft/compose` reads only; make sure it is **not** matched by the mutating families. Add `'draft/compose'` to the existing non-mutating list in the classification test at `test/adapters/messaging.test.ts` (the `classifies the message families` case).

- [ ] **Step 6: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm run format && npm test`

```bash
git add src/core/messages.ts src/core/router.ts src/adapters/chrome/messaging.ts test/adapters/messaging.test.ts
git commit -m "Expose draft composition to the surfaces as one message"
```

---

### Task 6: Extract `onPageSignature` and pin it with a test

**Files:**
- Create: `src/sidepanel/on-page-signature.ts`
- Create: `src/sidepanel/on-page-signature.test.ts`
- Modify: `src/sidepanel/main.ts` (delete the inline function, import the extracted one)

**Interfaces:**
- Produces: `onPageSignature(annotations: Annotation[], palette: HighlightColor[], resolvedIds: Set<Id>): string`.

**Why before Task 7:** the signature decides whether the note list repaints. Add a section picker without adding `section` to it and the student picks a section, the write succeeds and **the screen does not change** — a dead-looking control whose cause sits two layers away.

- [ ] **Step 1: Read the current implementation**

Find `function onPageSignature` in `src/sidepanel/main.ts` and note exactly which fields it folds in and how it reads `state`. The extracted version takes those inputs as parameters instead of closing over `state`.

- [ ] **Step 2: Write the failing test** — create `src/sidepanel/on-page-signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { onPageSignature } from './on-page-signature';
import type { Annotation, HighlightColor } from '../core/model/types';

const NOW = '2026-08-05T00:00:00.000Z';
const palette: HighlightColor[] = [{ id: 'c1', swatch: '#ffcc00', label: 'Evidence' }];
const base: Annotation = {
  id: 'a1', projectId: 'p1', documentId: 'd1',
  anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'q' }] },
  content: 'note', tags: [], status: 'open', author: 'u1',
  createdAt: NOW, updatedAt: NOW,
};
const sig = (a: Annotation[], p = palette, r = new Set<string>()) => onPageSignature(a, p, r);

describe('onPageSignature', () => {
  // Table-driven on purpose: this defends every future field someone adds to
  // the card and forgets to fold in here. The failure mode is a control that
  // saves correctly and never redraws — it reads as a dead button.
  const changes: Array<[string, Partial<Annotation>]> = [
    ['content', { content: 'edited' }],
    ['status', { status: 'includedInReport' }],
    ['colour', { color: 'c1' }],
    ['section', { section: 's1' }],
  ];
  for (const [field, patch] of changes) {
    it(`changes when ${field} changes`, () => {
      expect(sig([{ ...base, ...patch }])).not.toBe(sig([base]));
    });
  }

  it('changes when a passage is added or removed', () => {
    expect(sig([base, { ...base, id: 'a2' }])).not.toBe(sig([base]));
  });

  it('changes when a passage stops being placed on the page', () => {
    expect(sig([base], palette, new Set(['a1']))).not.toBe(sig([base]));
  });

  it('changes when the palette label changes, because the card shows it', () => {
    expect(sig([base], [{ id: 'c1', swatch: '#ffcc00', label: 'Renamed' }])).not.toBe(sig([base]));
  });

  it('stays the same for an unchanged list, so typing does not trigger a repaint', () => {
    expect(sig([base])).toBe(sig([{ ...base }]));
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npx vitest run src/sidepanel/on-page-signature.test.ts`
Expected: FAIL — cannot resolve `./on-page-signature`.

- [ ] **Step 4: Extract** — create `src/sidepanel/on-page-signature.ts` with the logic moved out of `main.ts`, taking its inputs as parameters and **including `section`**:

```ts
/**
 * A fingerprint of everything the on-page note list actually shows.
 *
 * `renderOnPageCard` rebuilds the list only when this changes. That guard is
 * what stopped a single note autosave from causing 13 DOM rebuilds (v1.7.4) —
 * rebuilds that replaced the textarea under the reader's hands and dropped
 * keystrokes. The cost of the guard is the opposite failure: a field the card
 * displays but the signature ignores looks like a control that does nothing.
 * Every displayed field belongs here, and `on-page-signature.test.ts` enforces it.
 */
import type { Annotation, HighlightColor, Id } from '../core/model/types';

export function onPageSignature(
  annotations: Annotation[],
  palette: HighlightColor[],
  resolvedIds: Set<Id>,
): string {
  const notes = annotations
    .map((a) =>
      [
        a.id,
        a.content,
        a.status,
        a.color ?? '',
        a.section ?? '',
        resolvedIds.has(a.id) ? '1' : '0',
      ].join(''),
    )
    .join('');
  const legend = palette.map((c) => `${c.id}:${c.swatch}:${c.label}`).join('');
  return `${notes}${legend}`;
}
```

In `src/sidepanel/main.ts`, delete the inline function and import this one, calling it with `state.pageAnnotations`, the active palette and `state.resolvedIds` at both existing call sites (`renderOnPageCard` and `savePageAnnotationContent`).

- [ ] **Step 5: Run and verify**

Run: `npx vitest run src/sidepanel/on-page-signature.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Prove the panel still behaves**

Run: `npm run build && npx playwright test e2e/sidepanel.spec.ts`
Expected: existing side-panel E2E green.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/on-page-signature.ts src/sidepanel/on-page-signature.test.ts src/sidepanel/main.ts
git commit -m "Make the panel's repaint guard testable, and teach it about sections"
```

---

### Task 7: Assign a section while reading

**Files:**
- Modify: `src/sidepanel/main.ts` (`makeOnPageCard`, plus a new `updatePageAnnotationSection`)
- Modify: `src/sidepanel/sidepanel.css` (or the panel's stylesheet — match the existing status control)
- Modify: `e2e/webannotation.spec.ts` (append a case)

**Interfaces:**
- Consumes: `resolveOutline` (Task 1); the extracted `onPageSignature` (Task 6).
- Produces: `updatePageAnnotationSection(id: Id, section: Id | undefined): Promise<void>`.

- [ ] **Step 1: Add the update function** — in `src/sidepanel/main.ts`, directly below `updatePageAnnotationStatus`:

```ts
async function updatePageAnnotationSection(id: Id, section: Id | undefined): Promise<void> {
  const idx = state.pageAnnotations.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const current = state.pageAnnotations[idx]!;
  const updated: Annotation = {
    ...current,
    ...(section === undefined ? {} : { section }),
    updatedAt: nowIso(),
  };
  if (section === undefined) delete (updated as { section?: Id }).section;
  state.pageAnnotations[idx] = updated;
  try {
    await sendRequest({ type: 'annotations/put', annotation: updated });
    const title = resolveOutline(activeProject()).find((s) => s.id === section)?.title;
    toast(title ? `Section · ${title}` : 'Removed from the outline');
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Couldn’t change section', true);
  }
}
```

`activeProject()` is whatever accessor `main.ts` already uses for the current project; if there is none, read it from `state` the way `activePalette()` does.

- [ ] **Step 2: Add the control to the card**

In `makeOnPageCard`, beside the status control, build a `<select>` **programmatically** (the panel builds DOM with `dataset`/`textContent` and is injection-proof by construction — keep it that way):

```ts
  const sectionPick = document.createElement('select');
  sectionPick.className = 'card-section';
  sectionPick.setAttribute('aria-label', 'Section of your draft');
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'No section';
  sectionPick.append(none);
  for (const s of resolveOutline(activeProject())) {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.title;
    sectionPick.append(option);
  }
  sectionPick.value = annotation.section ?? '';
  // `change`, not `input`: the list repaints on the resulting save, and a
  // repaint mid-selection would close an open dropdown under the pointer.
  sectionPick.onchange = () => {
    void updatePageAnnotationSection(annotation.id, sectionPick.value || undefined);
  };
```

Append `sectionPick` to the same footer element that holds the status control.

- [ ] **Step 3: Style it** — add a rule matching the existing footer controls:

```css
.card-section {
  font: inherit;
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  max-width: 140px;
}
```

Use the CSS custom properties the panel's stylesheet actually defines — read the file and match them; do not invent variable names.

- [ ] **Step 4: Write the E2E case** — append to `e2e/webannotation.spec.ts`:

```ts
test('assigning a section from the panel updates the card', async ({ page, context }) => {
  // …reuse the spec's existing setup that highlights a passage and opens the
  // panel as a tab; follow the neighbouring test's helper calls exactly…
  const pick = panel.locator('.card-section').first();
  await pick.selectOption({ label: 'Evidence' });
  // The write is optimistic AND the list repaints; if `section` were missing
  // from onPageSignature this assertion would fail while the database was
  // already correct — which is exactly the bug being guarded against.
  await expect(pick).toHaveValue(/.+/);
  await page.reload();
  await expect(panel.locator('.card-section').first()).not.toHaveValue('');
});
```

- [ ] **Step 5: Run**

Run: `npm run build && npx playwright test e2e/webannotation.spec.ts`
Expected: PASS. Use a **fresh** browser profile — a reused one may run a stale service worker that has never heard of the new message (see `doc/MANUAL-TEST-PLAN.md` §0.4).

- [ ] **Step 6: Full gate and commit**

```bash
git add src/sidepanel/ e2e/webannotation.spec.ts
git commit -m "Place a passage in the draft at the moment you take it"
```

---

### Task 8: The Outline route

**Files:**
- Modify: `src/options/main.ts` (`NAV` at line 135, the route union imported at line 78 from `src/options/view-model.ts`, a new `renderOutline`, and the `RENDERERS` map at line 509)
- Modify: `src/options/view-model.ts` (the `Route` union and `NAV_ROUTES`)
- Modify: `src/options/view-model.test.ts` (route count assertion)
- Modify: `src/options/options.css` (or the dashboard stylesheet)
- Modify: `e2e/dashboard.spec.ts` (nav count + a new Outline case)

**Interfaces:**
- Consumes: `resolveOutline`, `defaultOutline` (Task 1); `orderedEntries` (Task 3).
- Produces: route `'outline'`; `renderOutline(view, actions)`.

- [ ] **Step 1: Add the route to the union and the nav**

In `src/options/view-model.ts` add `'outline'` to the `Route` union and to `NAV_ROUTES`, positioned **after `'annotations'`**. Update the count assertion in `src/options/view-model.test.ts` (7 → 8).

In `src/options/main.ts`, insert into `NAV` after the `annotations` entry:

```ts
  {
    id: 'outline',
    label: 'Outline',
    // Deliberately NOT a total, unlike every other badge here: a total tells
    // the student nothing, while "7 unplaced" is the work outstanding — and it
    // disappears when the outline is complete.
    count: () => {
      const n = state.annotations.filter((a) => !a.section).length;
      return n > 0 ? n : undefined;
    },
    icon: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  },
```

- [ ] **Step 2: Register the renderer**

In the `RENDERERS` map at `src/options/main.ts:509`, add `outline: renderOutline,`.

- [ ] **Step 3: Implement `renderOutline`**

```ts
function outlineOf(): OutlineSection[] {
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  return project ? resolveOutline(project) : [];
}

function renderOutline(view: HTMLElement, actions: HTMLElement): void {
  const sections = outlineOf();
  const unplaced = orderedEntries(state.annotations.filter((a) => !a.section));
  const known = new Set(sections.map((s) => s.id));
  const strays = orderedEntries(
    state.annotations.filter((a) => a.section && !known.has(a.section)),
  );
  const loose = [...unplaced, ...strays];

  actions.innerHTML =
    `<button class="btn btn--sm" id="olAdd">Add section</button>` +
    `<button class="btn btn--sm" id="olCopy">${ICON.copy} Copy draft</button>` +
    `<button class="btn btn--sm" id="olMd">Download .md</button>`;

  if (state.annotations.length === 0) {
    view.innerHTML = emptyState(
      'Nothing to outline yet',
      'Highlight passages while you read and they collect here, ready to arrange.',
    );
    $('#olGo', view)?.addEventListener('click', () => go('annotations'));
    return;
  }

  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const head =
    `<div class="ol-head">` +
    (project?.researchQuestion
      ? `<div class="ol-q">${esc(project.researchQuestion)}</div>`
      : `<div class="ol-q ol-q--empty">No research question set</div>`) +
    `<div class="ol-meta">${project?.dueDate ? esc(dueLabel(project.dueDate)) : 'No due date'}` +
    ` · <button class="btn btn--ghost btn--sm" id="olEdit">Edit</button></div></div>`;

  const looseBlock =
    loose.length > 0
      ? `<section class="ol-sec ol-sec--loose"><h3>Unplaced (${loose.length})</h3>` +
        loose.map(annoRowHtml).join('') +
        `</section>`
      : '';

  const body = sections
    .map((s, i) => {
      const entries = orderedEntries(state.annotations.filter((a) => a.section === s.id));
      return (
        `<section class="ol-sec" data-sec="${esc(s.id)}">` +
        `<h3>${esc(s.title)} <span class="ol-n">${entries.length}</span>` +
        (entries.length === 0 ? `<span class="ol-warn">empty section</span>` : '') +
        `<span class="ol-tools">` +
        `<button class="btn btn--ghost btn--sm" data-up="${esc(s.id)}"${i === 0 ? ' disabled' : ''} aria-label="Move up">↑</button>` +
        `<button class="btn btn--ghost btn--sm" data-down="${esc(s.id)}"${i === sections.length - 1 ? ' disabled' : ''} aria-label="Move down">↓</button>` +
        `<button class="btn btn--ghost btn--sm" data-rename="${esc(s.id)}">Rename</button>` +
        `<button class="btn btn--ghost btn--sm" data-delsec="${esc(s.id)}">Delete</button>` +
        `</span></h3>` +
        entries.map(annoRowHtml).join('') +
        `</section>`
      );
    })
    .join('');

  view.innerHTML = head + looseBlock + body;
  wireOutline(view, sections);
}
```

`annoRowHtml(a)` renders one passage — colour dot, quote/anchor label, note, source line, and a section `<select>` — modelled on `drawAnnotations` at `src/options/main.ts:1497`. Every interpolation goes through `esc()`; the `<select>`'s `value` is set after insertion in `wireOutline`, not in the markup, so a title containing quotes cannot break out.

`dueLabel(iso)` returns `in 5 days` / `due today` / `2 days overdue` from a `YYYY-MM-DD` string compared against today's date at UTC midnight — dates, not timestamps, so the answer does not shift across time zones.

`wireOutline` attaches: `data-up` / `data-down` (swap entries in `project.outline`, `projects/put`), `data-rename` (popover with a text input, then `projects/put`), `data-delsec` (confirm popover whose text names the count, then remove the section **and clear `section` on its annotations via `annotations/put`** so they become unplaced), the per-row `<select>` (`annotations/put`), `#olAdd`, `#olEdit` (`go('settings')`), and `#olCopy` / `#olMd` (Task 9).

When `project.outline` is absent, the first mutating action writes `resolveOutline(project)` back to the project first — this is where the derived outline becomes stored.

- [ ] **Step 4: Style**

Add `.ol-head`, `.ol-q`, `.ol-meta`, `.ol-sec`, `.ol-sec--loose`, `.ol-n`, `.ol-warn`, `.ol-tools` rules to the dashboard stylesheet, reusing the existing custom properties and the `.anno` card look. `.ol-warn` uses the same colour token as other warnings in the sheet.

- [ ] **Step 5: E2E**

In `e2e/dashboard.spec.ts`, update the nav-count assertion (7 → 8) and add:

```ts
test('deleting a section keeps its passages, as unplaced', async ({ page }) => {
  // …spec's existing setup: seed a project with one document and two
  // annotations, one assigned to a section; follow the neighbouring tests…
  await page.getByRole('link', { name: 'Outline' }).click();
  const before = await page.locator('.ol-sec .anno').count();
  await page.locator('[data-delsec]').first().click();
  await page.getByRole('button', { name: /delete/i }).click();
  await expect(page.locator('.ol-sec--loose .anno')).toHaveCount(1);
  expect(await page.locator('.ol-sec .anno').count()).toBe(before);
});
```

- [ ] **Step 6: Run and commit**

Run: `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npx playwright test e2e/dashboard.spec.ts`

```bash
git add src/options/ e2e/dashboard.spec.ts
git commit -m "Give the dashboard an outline you can actually arrange"
```

---

### Task 9: Export — clipboard and file

**Files:**
- Create: `src/options/export-draft.ts`
- Create: `src/options/export-draft.test.ts`
- Modify: `src/options/main.ts` (wire `#olCopy` / `#olMd`)
- Create: `e2e/draft-export.spec.ts`

**Interfaces:**
- Consumes: `draft/compose` (Task 5); `draftToHtml`, `draftToMarkdown` (Task 4).
- Produces: `draftFilename(projectName: string, today: string): string`; `copyDraft(draft): Promise<'rich' | 'plain'>`; `downloadMarkdown(name, body): void`.

- [ ] **Step 1: Write the failing test** — create `src/options/export-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { draftFilename } from './export-draft';

describe('draftFilename', () => {
  it('is readable and dated', () => {
    expect(draftFilename('My Research', '2026-08-05')).toBe('draft-my-research-2026-08-05.md');
  });

  it('strips characters a file system will not take', () => {
    expect(draftFilename('A/B: "C"?', '2026-08-05')).toBe('draft-a-b-c-2026-08-05.md');
  });

  it('still produces a name when the project name has nothing usable', () => {
    expect(draftFilename('///', '2026-08-05')).toBe('draft-2026-08-05.md');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/options/export-draft.test.ts`
Expected: FAIL — cannot resolve `./export-draft`.

- [ ] **Step 3: Implement** — create `src/options/export-draft.ts`:

```ts
/** Clipboard and file delivery for a composed draft. Kept out of `main.ts`
 *  because the filename rule is worth testing on its own. */
import type { Draft } from '../core/usecases/draft';
import { draftToHtml, draftToMarkdown } from '../core/draft/serialise';

export function draftFilename(projectName: string, today: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug ? `draft-${slug}-${today}.md` : `draft-${today}.md`;
}

/**
 * Copy the draft, keeping formatting where the platform allows it.
 *
 * Returns which flavour actually landed so the caller can tell the truth: a
 * silent drop to plain text would leave a student wondering why their
 * bibliography lost its italics.
 */
export async function copyDraft(draft: Draft): Promise<'rich' | 'plain'> {
  const html = draftToHtml(draft);
  const text = draftToMarkdown(draft);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ]);
    return 'rich';
  } catch {
    await navigator.clipboard.writeText(text);
    return 'plain';
  }
}

/** Save via an object URL — no `downloads` permission, which would cost at
 *  store review for no gain here. */
export function downloadMarkdown(filename: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can race the download in Chrome; one turn is enough.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 4: Run and verify**

Run: `npx vitest run src/options/export-draft.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the buttons** — in `wireOutline` (Task 8):

```ts
  $('#olCopy', actions).onclick = async () => {
    if (!state.activeProjectId) return;
    try {
      const draft = await sendRequest({
        type: 'draft/compose',
        projectId: state.activeProjectId,
        template: activeTemplate(),
        flavour: 'html',
        ...(state.activeStyleId ? { styleId: state.activeStyleId } : {}),
      });
      const how = await copyDraft(draft);
      const warn = draft.missingReferenceCount > 0
        ? ` · ${draft.missingReferenceCount} source${draft.missingReferenceCount === 1 ? '' : 's'} without citation data`
        : '';
      toast(
        how === 'rich'
          ? `Draft copied${warn}`
          : `Copied without formatting — the bibliography's italics need fixing by hand${warn}`,
        ICON.copy,
        how !== 'rich',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t build the draft', ICON.warn, true);
    }
  };
```

`#olMd` does the same with `flavour: 'text'`, then `downloadMarkdown(draftFilename(projectName, todayIso()), draftToMarkdown(draft))`.

`activeTemplate()` and `state.activeStyleId` are whatever `main.ts` already passes to `citations/bibliography` at line 700 — reuse those exact expressions rather than inventing new ones. `toast()` escapes its own message, so do not pre-escape.

- [ ] **Step 6: E2E for the clipboard** — create `e2e/draft-export.spec.ts`:

```ts
import { test, expect } from './fixtures';

test('copying a draft puts real markup on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  // …seed a project with one document, one reference and one assigned
  // annotation using the same helpers as e2e/dashboard.spec.ts…
  await page.getByRole('link', { name: 'Outline' }).click();
  await page.getByRole('button', { name: /copy draft/i }).click();
  await expect(page.locator('.toast')).toContainText(/copied/i);

  // The only proof that survives: read the html flavour back out. jsdom has no
  // ClipboardItem, so no unit test can establish this.
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) {
        return await (await item.getType('text/html')).text();
      }
    }
    return '';
  });
  expect(html).toContain('<blockquote>');
  expect(html).toContain('<h2>');
});
```

- [ ] **Step 7: Run**

Run: `npm run build && npx playwright test e2e/draft-export.spec.ts`
Expected: PASS. Fresh profile.

- [ ] **Step 8: Commit**

```bash
git add src/options/export-draft.ts src/options/export-draft.test.ts src/options/main.ts e2e/draft-export.spec.ts
git commit -m "Hand the draft over: formatted to the clipboard, or as a file"
```

---

### Task 10: Research question, due date, and the nudges that connect them

**Files:**
- Modify: `src/options/main.ts` (`drawProjectSettings`, the Overview tile, the nudge table)
- Modify: `src/sidepanel/main.ts` (nudge additions)
- Modify: `e2e/dashboard.spec.ts` (append)

**Interfaces:**
- Consumes: `Project.researchQuestion`, `Project.dueDate` (Task 1).

- [ ] **Step 1: Add the two fields to Settings**

In `drawProjectSettings`, beside the existing project-name input and default-style select, add:

```ts
    `<label class="fld"><span>Research question</span>
       <input id="setQ" class="sel" style="width:100%" maxlength="300"
              placeholder="What is this project trying to answer?"
              value="${esc(project.researchQuestion ?? '')}"></label>` +
    `<label class="fld"><span>Due date</span>
       <input id="setDue" class="sel" type="date" value="${esc(project.dueDate ?? '')}"></label>`
```

Save on `change` through the same `projects/put` path the name field already uses. An empty value clears the field rather than storing `''`:

```ts
  const q = $<HTMLInputElement>('#setQ').value.trim();
  const due = $<HTMLInputElement>('#setDue').value;
  const updated: Project = {
    ...project,
    ...(q ? { researchQuestion: q } : {}),
    ...(due ? { dueDate: due } : {}),
    updatedAt: nowIso(),
  };
  if (!q) delete (updated as { researchQuestion?: string }).researchQuestion;
  if (!due) delete (updated as { dueDate?: string }).dueDate;
```

- [ ] **Step 2: Complete the Overview tile**

Task 1 left it as `N unplaced · M members`. Add the due date in front when set, using the same `dueLabel` helper Task 8 introduced:

```ts
<div class="tsub">${project?.dueDate ? esc(dueLabel(project.dueDate)) + ' · ' : ''}${state.annotations.filter((a) => !a.section).length} unplaced · ${members} member${members === 1 ? '' : 's'}</div>
```

- [ ] **Step 3: Add the two journey nudges**

In the existing nudge mechanism (the one that fires filed → annotate → status → cite → bibliography, once per session and never after the checklist is dismissed), add:

| Trigger | Copy |
| --- | --- |
| first annotation gains a `section` | `Your draft is taking shape — see it in Outline` |
| an assignment leaves zero unplaced, and there is at least one placed passage | `Ready to export — copy the draft into your editor` |

Both link to the Outline route. Follow the existing nudge registration exactly — do not add a second mechanism.

- [ ] **Step 4: Close the empty states**

- Empty Outline (no annotations at all) → button to Annotations, wired in Task 8 Step 3.
- Empty Annotations list → its existing empty state gains a line pointing at Outline once at least one section exists.

- [ ] **Step 5: E2E**

Append to `e2e/dashboard.spec.ts`:

```ts
test('a research question set in Settings shows above the outline', async ({ page }) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('#setQ').fill('Did subsidies increase adoption?');
  await page.locator('#setQ').blur();
  await page.getByRole('link', { name: 'Outline' }).click();
  await expect(page.locator('.ol-q')).toHaveText('Did subsidies increase adoption?');
});
```

- [ ] **Step 6: Run and commit**

Run: `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npx playwright test`

```bash
git add src/options/main.ts src/sidepanel/main.ts e2e/dashboard.spec.ts
git commit -m "Say what the project is for, and when it is due"
```

---

### Task 11: Documentation and release

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md` (**new section only** — released sections are append-only and protected)
- Modify: `README.md` (quick start + the "What it does" table)
- Modify: `doc/STATUS.md`
- Modify: `doc/MANUAL-TEST-PLAN.md` (new scenario S12)
- Modify: `doc/architecture.md`, `doc/data-model.md` (the new fields and message)

- [ ] **Step 1: Write manual scenario S12**

Append to `doc/MANUAL-TEST-PLAN.md`, matching the existing scenario shape (steps · expected result · pitfalls · DevTools debugging):

- Assign three passages across two sections from the side panel, one from the dashboard.
- Copy the draft, paste into Word or Google Docs.
- **Expected:** section headings; each quote followed by its citation; the reference list at the end with the journal title in *italics* and a hanging indent; only cited sources listed.
- **Pitfalls:** a reused Chrome profile serving a stale service worker (§0.4) — `draft/compose` will look unknown; a project with nothing assigned falls back to colour grouping and says so; a hand-added PDF has no reference and shows the "no bibliographic data" marker.
- **Debugging:** in the dashboard DevTools console,
  `await chrome.runtime.sendMessage({type:'draft/compose', projectId:'<id>', template:'apa', flavour:'html'})`
  returns the structure the export is built from — check `missingReferenceCount` and `groupedByColour` first.

- [ ] **Step 2: Update README**

Quick start gains a step between "Annotate" and "Cite":

> **Outline it**: Dashboard → **Outline**. Drop each passage into a section of your essay, then **Copy draft** — the whole thing lands in Word with its citations already correct and only the sources you used in the reference list.

The "What it does" table gains an **Outline** row, and the **Citations** row notes that a copied draft is cited as one document, so numeric styles number correctly.

- [ ] **Step 3: Version, changelog, status**

Bump `package.json` to **1.8.0** (a feature, one minor version per milestone). Add a new `CHANGELOG.md` section describing the outline, the section picker, the export, and the citation-correctness fix — including that the per-row **Cite** button's numeric-style behaviour is unchanged and remains a known limitation, or fix it in a follow-up. Update `doc/STATUS.md` with the release.

- [ ] **Step 4: Update the architecture docs**

`doc/architecture.md`: the `draft/compose` message and the `src/core/draft/` module. `doc/data-model.md`: `Project.outline`, `researchQuestion`, `dueDate`, the deprecation of `sections`, and `Annotation.section` — including the note that no migration was needed because every field is optional.

- [ ] **Step 5: Full gate, package, tag**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build && npm run test:e2e && npm run package`
Expected: all green; the package script reports its file count with 0 warnings.

```bash
git add -A
git commit -m "feat: v1.8.0 — the outline release, from highlights to a draft"
git tag v1.8.0
git push --follow-tags -u origin feat/draft-bridge
```

Open a PR to `main` rather than pushing to it directly; create the GitHub release with the validated zip after merge, per `doc/DISTRIBUTION.md`.

---

## Self-review notes

**Spec coverage.** Model + validation → Task 1. `formatRun` and the three golden citation tests → Task 2. `composeDraft`, ordering, colour fallback, missing-reference degradation → Task 3. Serialisers and the escaping test → Task 4. Message → Task 5. `onPageSignature` debt → Task 6. Side-panel picker → Task 7. Outline route, badge, section CRUD, delete-keeps-passages → Task 8. Clipboard, `.md`, clipboard E2E → Task 9. Research question, due date, Overview tile, nudges, empty states → Task 10. Docs, S12, release → Task 11.

**Known gap, deliberately named:** the spec observes that the existing per-row **Cite** button returns `(1)` for every source under a numeric style. That is a pre-existing bug outside this feature's scope; Task 11 Step 3 requires the changelog to state it plainly rather than let a reader assume this release fixed it. Fixing it means routing that button through `formatRun` with the project's full citation order, which is its own small change.

**Type consistency check:** `resolveOutline` / `defaultOutline` / `DEFAULT_OUTLINE_TITLES` (Task 1) are used under those exact names in Tasks 3, 7 and 8. `orderedEntries` (Task 3) is used in Task 8. `inTextFormatted` is the field name in Tasks 3, 4 and 9 — never `inTextHtml`. `formatRun(run, template, flavour, style?)` keeps that parameter order in Tasks 2, 3 and the stub formatters. `draft/compose` carries `template` as well as `styleId`, matching the sibling `citations/*` messages rather than resolving the template in the worker.
