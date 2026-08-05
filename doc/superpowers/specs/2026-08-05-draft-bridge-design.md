# Outline & draft export — the bridge from highlights to a written essay

_Design spec · 2026-08-05 · branch `feat/draft-bridge` off `main` (v1.7.4)_

## Context

The extension collects well and delivers nothing. A research session ends with highlights in the
dashboard; the student's deliverable is an essay in a word processor. Today the only bridge is
`navigator.clipboard.writeText` on a single in-text citation (`src/options/main.ts:1619`) or on the
whole-project bibliography (`src/options/main.ts:700`). There is no way to say "give me the passages
I collected for this assignment, in the order I want to argue them, each with its citation".

Retention dies at exactly that point: the student leaves to write and does not come back, so the
colours, statuses and citation work never pay off.

Two model fields already anticipate this feature and are dead in the UI:

- **`Project.sections: string[]`** — typed (`src/core/model/types.ts:100`), validated on snapshot
  import (`src/core/snapshot/validate.ts:241`), and hardcoded to
  `['Literature','Methods','Data','Report']` in four places (`src/sidepanel/main.ts:151`,
  `src/sidepanel/main.ts:1083`, `src/options/main.ts:271`, `src/core/usecases/web-annotation.ts:44`).
  Nothing edits it. Its only use in the whole UI is printing "4 sections" on an Overview tile
  (`src/options/main.ts:548`). `Document.section?` is never assigned anywhere.
- **`Annotation.tags: string[]`** — searched (`src/options/main.ts:1485`) and rendered as chips
  (`src/options/main.ts:1510`), with no UI to add one. Always empty.

This work finishes the first and leaves the second alone.

The target user is a UK undergraduate: the vendored `solent-university-harvard.csl` is the tell.
They usually have no existing reference library to import, they write in Word, and they work to a
brief with a deadline and a required style.

## Decisions (settled in brainstorming)

1. **Outline scale:** editable sections plus a per-highlight assignment. Not drag-and-drop (a large
   amount of code against a full-redraw `render()`, for little gain over an ordered list), and not
   "just group by colour" (a colour is the *type* of a passage, not its *place in the argument*).
   Colour grouping survives only as the fallback when nothing has been assigned.
2. **Export:** rich clipboard (`text/html` + `text/plain`) as the primary path, plus a `.md`
   download. No `.docx` generation — a bundled docx library is a new runtime dependency and a bigger
   store package for an outcome the HTML clipboard already achieves in Word.
3. **Assignment framing:** minimal — a research question and a due date. No word-count target: it
   would count other people's quoted words, which is easy to misread as progress.
4. **When the student assigns a section:** both while reading (side-panel note card, highest
   context) and later in bulk (an "Unplaced" bucket in Outline, when the shape of the argument is
   known).
5. **Composition lives in the core**, behind a new `draft/compose` message — not assembled in the
   dashboard from existing citation messages. See "Why the obvious approach is wrong" below.

## Why the obvious approach is wrong

Composing the draft in `src/options/main.ts` from `citations/document` per source plus
`citations/bibliography` for the list looks cheaper and is incorrect. Four findings, each verified
against the vendored CSL files with the project's own citeproc build:

**1. `citations/bibliography` takes a `projectId`** (`src/core/messages.ts:74`,
`src/core/usecases/citations.ts:42`) — every source in the project. An essay's reference list
contains what was cited, not everything that was read.

**2. One `.format('citation')` call renders one cluster, not one citation per source.**
`@citation-js/plugin-csl/lib/citation.js:41-46` registers all items with the engine but processes a
single cluster, so **every source comes out as `(1)` in Vancouver**. This is not a new bug: the
existing per-row **Cite** button already returns `(1)` for every source under a numeric style.

**3. citeproc disambiguates retroactively.** Passing only `citationsPre` (the clusters before this
one) produces an inconsistent document — measured on `solent-university-harvard.csl` with citation
order `C, A, B, A`:

```
citationsPre only:   C=(Lis 2020)  A=(Nowak 2016)   B=(Nowak 2016b)  A=(Nowak 2016a)
                                      ^^^^ same source, once without the letter
citationsPre+Post:   C=(Lis 2020)  A=(Nowak 2016a)  B=(Nowak 2016b)  A=(Nowak 2016a)
```

When cluster 1 is formatted, the engine does not yet know a second Nowak-2016 appears later, so it
freezes an answer that stops being true. Every call must see the clusters **before and after** it.

**4. The bibliography must be given the cited items in first-citation order.** Vancouver numbers the
reference list by order of first citation, and a bibliography call runs on an engine that never saw
our clusters:

```
in-text:                    C=(1)      A=(2)      B=(3)
input order:                1. Nowak   2. Nowak   3. Lis    <- numbers do not match the text
first-citation order:       1. Lis     2. Nowak   3. Nowak  <- correct
```

Author–date styles (Harvard, APA) produce identical output either way — their sort is style-defined
— so this is one rule with no exceptions.

**5. `format: 'html'` works** and is what makes the clipboard promise real: `<i>Land Use Policy</i>`,
and `csl-left-margin`/`csl-right-inline` for a hanging indent. The adapter currently hardcodes
`format: 'text'` in every method (`src/adapters/citation/citejs.ts`).

The underlying principle: **a citation is a property of the document, not of the source.** "How do I
cite Nowak" has no answer without "what else is in this essay".

## Data model

All new fields are optional, and no new object store or index is needed — the dashboard already
loads every annotation for a project. **`DB_VERSION` stays at 5; there is no migration.**

```ts
/** One section of the draft. The id is stable, so renaming a section keeps its passages. */
export interface OutlineSection {
  id: Id;
  title: string;
}

export interface Project {
  // …
  /** Draft structure. Absent -> seeded from `sections`, else from the defaults. */
  outline?: OutlineSection[];
  /** The question this project answers. Shown above the outline. */
  researchQuestion?: string;
  /** Hand-in date. A calendar fact, not an instant. */
  dueDate?: IsoDate;

  /** @deprecated Superseded by `outline`. Still accepted on import and seeded
   *  into `outline` once; never written again. */
  sections?: string[];
}

export interface Annotation {
  // …
  /** `OutlineSection.id` — exactly as `color` holds a `HighlightColor.id`. */
  section?: Id;
}
```

**Why ids and not names.** `Annotation.section` must not hold a section *title*: renaming a section
would orphan every passage in it, and two sections sharing a title would merge. The codebase already
solved this for the highlight palette — `HighlightColor { id, swatch, label }` with
`Annotation.color` holding the id (`src/core/model/types.ts:161`) — and the comment there explains
why the palette lives on the project: so the legend travels with a shared snapshot. The outline has
identical requirements, so it copies the shape that already works.

**Retiring `sections`.** Where `outline` is absent, `resolveOutline()` (see Architecture) derives it
from `sections` by minting an id per title, so the existing value is promoted rather than discarded;
the derived outline is written back only when the student first edits it. After that the field is
accepted on import and ignored. Making it optional touches exactly one UI site, the Overview tile at
`src/options/main.ts:548`, which is being rewritten anyway.

**Default outline for new projects** changes from `Literature / Methods / Data / Report` (the shape
of a research report) to `Introduction / Background / Evidence / Counter-arguments / Conclusion` (the
shape of an essay), at the four hardcode sites listed in Context.

**Snapshot validation** (`src/core/snapshot/validate.ts`) — an imported snapshot is somebody else's
data: `outline` is a list of `{id, title}` with the id checked against the existing id pattern and
the title length-capped; `Annotation.section` must name a section that exists **in the same
project**, otherwise the annotation is imported as unplaced rather than rejected.

## Architecture

### Citation port — one new method

`src/core/ports/citation.ts`. Existing methods are unchanged; there are only two implementations
(`CiteJsFormatter` and one stub in `test/core/citations.test.ts`).

```ts
/** A whole document's citing, resolved in a single engine state. */
export interface CitationRun {
  items: CslItem[];
  /** Source ids in the order they are cited in the draft. Repeats allowed. */
  order: Id[];
}

export interface CitationRunOutput {
  /** One citation per position in `order` — same length, same order. */
  inText: string[];
  /** The reference list, in the order the style dictates. */
  bibliography: string;
}

interface CitationFormatter {
  // …existing methods unchanged…
  /** `flavour: 'html'` keeps the italics a word processor needs. */
  formatRun(
    run: CitationRun,
    template: string,
    flavour: 'text' | 'html',
    style?: CitationStyle,
  ): Promise<CitationRunOutput>;
}
```

The adapter implements `formatRun` by calling `format('citation', …)` once per position with
`entry: [id]`, `citationsPre` = the earlier clusters and `citationsPost` = the later ones, then
`format('bibliography', …)` over the cited items **sorted by first citation**. It reuses
`ensureTemplate`, `compileCsl`, `applyRulesToItem` and `applyDoiFormat` exactly as the existing
methods do.

### Draft use-case — `src/core/usecases/draft.ts`

Pure: no `chrome.*`, no DOM, no IndexedDB types.

```ts
export interface DraftEntry {
  annotationId: Id;
  /** The quoted passage. Absent for a dragged PDF region — see Edge cases. */
  quote?: string;
  /** The student's own words. May be empty. */
  note: string;
  /** Rendered by citeproc in the requested flavour, already correct for the
   *  whole draft. Never escape it: in `html` that would kill the italics, and
   *  in `text` it is not user input in the first place. */
  inTextFormatted: string;
  /** Palette label, so the taxonomy survives into the draft. */
  colorLabel?: string;
  /** Where in the source, e.g. "PDF p. 4". Never presented as a printed page. */
  locator?: string;
  /** No Reference record exists for this passage's document. */
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
  dueDate?: IsoDate;
  styleLabel: string;
  sections: DraftSection[];
  /** Passages with no section. Always rendered last, under its own heading. */
  unplaced: DraftEntry[];
  bibliography: string;
  /** Nothing was assigned, so sections are colour labels rather than an outline. */
  groupedByColour: boolean;
  /** Count of passages whose document has no Reference. Drives the export warning. */
  missingReferenceCount: number;
}

export async function composeDraft(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { projectId: Id; flavour: 'text' | 'html'; style?: CitationStyle },
): Promise<Draft>;
```

Order of operations is forced by the findings above: **fix the section order and the entry order
within each section -> derive `order` from it -> one `formatRun` -> hand `inText[i]` back to each
entry -> bibliography over the cited items in first-citation order.**

Entries within a section are ordered by `Annotation.createdAt` ascending, and sections by their
position in `outline`. This ordering is **one exported function** used by both `composeDraft` and the
Outline view, not two agreeing implementations: it determines `order`, and `order` determines
Vancouver's numbering, so a sort difference between the screen and the export would renumber the
essay.

The same module exports `resolveOutline(project): OutlineSection[]` — the single answer to "what are
this project's sections", used by `composeDraft`, the Outline view and the side-panel picker alike:
`project.outline` when present, else `project.sections` mapped to minted ids, else the defaults. It
is pure and writes nothing; the seeded value is persisted only when the student first edits the
outline. Without one shared resolver, a project mid-migration would show one set of sections on
screen and compose against another.

### Serialisers — `src/core/draft/`

Pure functions over `Draft`:

- `draftToHtml(draft)` — the clipboard's `text/html` flavour.
- `draftToMarkdown(draft)` — the `.md` file body.

`quote` and `note` are text from arbitrary web pages and **must** go through `esc()`;
`inTextFormatted` and `bibliography` come from citeproc and **must not** be escaped, or the italics
die. The field names carry the distinction so a mistake is visible at the point of use. This is
exactly the shape in which injection bugs are born, and the reason the draft model returns a
structure rather than a string.

Returning a structure also avoids a second trap: there is no `DOMParser` in a service worker, so
deriving Markdown from generated HTML would mean hand-writing an HTML parser.

### Message

`draft/compose { projectId; flavour: 'text' | 'html'; styleId? } -> Draft`, appended to
`src/core/messages.ts` and `src/core/router.ts`. Surfaces never touch storage. The dashboard calls it
once per export action: `html` for the clipboard, `text` for the `.md` file.

The Outline **view** does not call it — it renders from annotations and document metadata, so
citeproc runs only on an actual export.

## Surfaces

### Dashboard route `outline`

Added to `NAV` (`src/options/main.ts:135`) directly after Annotations, which it feeds on:
Overview · Documents · Annotations · **Outline** · References · Citation styles · Team · Settings.

Its badge shows the **number of unplaced passages**, not a total. This deviates from every other
badge in `NAV` and is deliberate: a total tells the student nothing, while "7" is the work
outstanding, and it disappears when the outline is complete.

Layout:

```
+- Did direct subsidies increase precision-farming adoption? ----+
|  due in 5 days · Harvard (Solent)                      [Edit]  |
+----------------------------------------------------------------+

  ! Unplaced (7)                                  <- only when non-empty
     * "Farmers cited upfront cost..."   Nowak · 2016
       my note: contradicts Kowalski            [ Section v ]

  > Introduction            3        [^] [v] [rename] [delete]
  > Barriers to adoption    7
  > Counter-arguments       0   ! empty section
  > Conclusion              1

                            [ Copy draft ]  [ Download .md ]
```

- **Unplaced sits at the top** when non-empty: it is the work, not a footnote.
- **An empty section is flagged.** "Counter-arguments: 0" is the single most valuable thing this
  view can tell an undergraduate — a missing counter-argument is a common way to lose marks.
- **Section order via `^`/`v` buttons**, per decision 1.
- **Deleting a section does not delete its passages**: they move to Unplaced, and the confirmation
  says so. Same pattern as the in-use guard on palette colour deletion in Settings.
- The research question and due date are **read-only here**; `[Edit]` calls `go('settings')`, exactly
  as the colour legend already does (`src/options/main.ts:1443`). One source of truth.

### Side panel — assign while reading

The note card gains a section control beside the status control. Implementation mirrors
`updatePageAnnotationStatus` (`src/sidepanel/main.ts:611`): optimistic update of
`state.pageAnnotations`, `annotations/put`, toast on failure.

**`section` must be added to `onPageSignature()`.** That signature decides whether the note list
rebuilds; omit the field and the student picks a section, the write succeeds, and the screen does not
change — a bug that reads as a dead control while its cause sits two layers away. The same applies to
the palette in the dashboard.

The control must also survive the rebuild it triggers: either route it through
`captureFocusedNoteEdit`/`restoreFocusedNoteEdit`, or use the same popover mechanism as status, which
already lives outside the rebuilt subtree.

### Settings and Overview

**Settings** — the existing project card (name + default citation style) gains **research question**
and **due date**. No new screen.

**Overview** — the Sources tile currently prints `${p.sections.length} sections`, the ghost field
from Context. It is replaced with `due in 5 days · 7 unplaced`.

### Journey nudges

The existing chain (filed -> annotate -> status -> cite -> bibliography) gains two links:

| After | Nudge |
| --- | --- |
| first passage assigned to a section | "Your draft is taking shape — see it in Outline" |
| everything assigned, nothing unplaced | "Ready to export — copy the draft into your editor" |

Empty states link both ways: an empty Outline points at Annotations; an empty Unplaced bucket
congratulates and offers the export button.

## Export

### Clipboard

```ts
const html = draftToHtml(draft);
const text = draftToMarkdown(draft);
await navigator.clipboard.write([
  new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  }),
]);
```

An extension page is a secure context and the call originates from a click, so user activation holds.
If `write()` throws (no document focus, refusal), fall back to `writeText(text)` and **say so**:
"Copied without formatting — the italics in the bibliography need fixing by hand." No silent success.

### `.md` download

`URL.createObjectURL` + `<a download>` + `revokeObjectURL`. **No new permission** — `chrome.downloads`
is not needed, and adding it would cost at store review. Filename from the project name passed
through a filesystem-safe filter, plus the date: `draft-my-research-2026-08-05.md`.

### Entry shape

```md
## Barriers to adoption

> Farmers cited upfront cost as the single largest barrier. (Nowak and Kowalski, 2016a, p. [page?])

*My note:* this contradicts Kowalski's claim that training is the bottleneck.
```

## Edge cases

### Where the quote comes from

| Source | Quote | Locator |
| --- | --- | --- |
| Web selection | `TextQuoteSelector.exact` — always present | none |
| PDF text highlight | `PdfRegionSelector.quote` — present | PDF page |
| **Dragged PDF region** | **`quote` absent** — it is coordinates, not text | PDF page |

A passage with no quote is **not dropped**. It enters the draft as the student's own note annotated
`<region, p. 4 — no text captured>`.

### The page number

A PDF page index is not the journal's printed page: a passage on file page 4 of an article starting
at p. 150 is on p. 153. Emitting `(Nowak, 2016a, p. 4)` would put a false citation into submitted
work.

Rejected: deriving the page from `metadata.pages` (front matter and inserts break the offset, and the
error would be invisible); omitting the page silently (Harvard wants a page for a direct quote, so
this yields a quietly incomplete citation).

**Chosen:** a direct quote without a trustworthy page gets a visible `[page?]` placeholder, with the
file page alongside as a navigation aid. A visible gap beats an invisible error.

### Everything else

| Situation | Behaviour |
| --- | --- |
| No passages at all | Export disabled; empty state links to Annotations |
| Nothing assigned | `groupedByColour: true` — group by colour label, with a heading saying this is a stand-in structure |
| **Document with no Reference** (typically a hand-added PDF) | The passage **stays**; instead of a citation it carries `<no bibliographic data — complete it in Documents>`, and the export shows a warning with the count. One gap must not sink the export |
| `Annotation.section` names a deleted section | Treated as unplaced, both at import and at runtime |
| Empty note **and** no quote | Enters as `<region, p. 4 — no text captured>` |
| Very long quote | The existing v0.27.4 quote cap already applies |
| Passages from several sources in one section | Ordered by section, then by when the passage was added. Not grouped by source: an essay follows the argument, not the bibliography |

`capture/page` creates a Reference (`src/core/usecases/capture.ts:60`, `:82`), so web captures always
have one; the missing-reference case is concentrated on manually added PDFs.

## Testing

### Golden citation tests — the three that matter

Against the real vendored CSL, as the existing golden tests do. Draft order `C, A, B, A`:

1. **Vancouver — number correspondence, not string equality.** The test extracts the number from each
   in-text citation and asserts it points at the right bibliography position. Asserting the two
   strings separately would pass on the finding-4 mismatch.
2. **Harvard/APA — retroactive disambiguation.** The first occurrence of A must read `2016a`, not
   `2016`. A test that passes with `citationsPre` alone is a green test over broken behaviour.
3. **Repeated source.** The fourth passage (A again) must render identically to the second. This is
   the first thing to break under a "cache the citation per document" optimisation.

### Core unit tests

`composeDraft`: grouping and ordering · unplaced bucket · colour fallback · **missing-Reference
degradation** · `section` naming a deleted section.

`draftToHtml` / `draftToMarkdown`: golden output, plus **both escaping assertions in one test** — a
quote containing `<script>` and `&` comes out escaped, while citeproc's `<i>` survives untouched.
One test, because it is one decision.

`validate.ts`: `outline` from a hostile snapshot · `Annotation.section` pointing outside the project.

### Debt repaid on the way

`onPageSignature()` is trapped inside `src/sidepanel/main.ts` and cannot be tested, yet it decides
whether the panel repaints. Extract it to a pure module and add a table-driven test: *for every field
the card displays, changing that field must change the signature.* This defends every future field
someone adds to the card, not just `section`. It is the same class of bug as the v1.7.4 repaint storm,
with the sign reversed.

### E2E (Playwright) — only what nothing else can prove

| Scenario | What it actually proves |
| --- | --- |
| Assign a section from the side panel | the `onPageSignature` trap — the screen keeps up with the write |
| Outline: add / rename / reorder / delete a section | deleting a section with passages **does not delete the passages** |
| **Read `text/html` back from the clipboard** | the only proof `<i>` really lands there — the whole "italics survive the paste" promise |
| `write()` failure -> `writeText` | the message tells the truth about lost formatting |
| Download `.md` and read it | the file is neither empty nor HTML |
| Unplaced badge | disappears at zero |

The clipboard test is where Playwright is irreplaceable: `ClipboardItem` with `text/html` does not
exist in jsdom, so a unit test could only confirm we build the right string, never that Chrome
accepts and returns it.

**Run E2E on a fresh profile.** `draft/compose` is a new message in the service worker; on a reused
profile a stale worker answers "unknown message type", which reads as a core bug. See
`doc/MANUAL-TEST-PLAN.md` §0.4.

### Manual

Pasting into a real Word document cannot be automated. It becomes scenario **S12** in
`doc/MANUAL-TEST-PLAN.md`, with the expected result (italic journal title, hanging indent) and the
DevTools debugging notes the other scenarios carry.

## Out of scope

- Drag-and-drop reordering of passages (decision 1).
- `.docx` generation (decision 2).
- Word-count targets (decision 3).
- Mapping PDF page indexes to printed page numbers — a per-document offset is a feature of its own.
- BibTeX/RIS import and export, automatic backup, global cross-project search, PDF metadata
  extraction. All were weighed in this brainstorm and stay on the backlog; automatic backup is the
  most urgent of them, because this feature increases what a student stands to lose.
- Reviving `Annotation.tags`. Colours and sections are two taxonomies already; a third needs its own
  justification.

## Release

One minor version — the outline release. `package.json`, a new `CHANGELOG.md` section, `README.md`
(the feature table and the quick start gain an Outline step), `doc/STATUS.md`,
`doc/MANUAL-TEST-PLAN.md` §S12. Documentation ships with the release, per CLAUDE.md.
