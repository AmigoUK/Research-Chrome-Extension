# Changelog

All notable changes to **Scientific Context Notes** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_The audit's findings are all closed. See `doc/STATUS.md`._

## [0.24.0] — 2026-07-24

Everything the code audit found, other than the injection already fixed in v0.22.0 and the icons in
v0.23.0. Each item was reproduced or verified before it was changed.

### Security & privacy

- **`web_accessible_resources` is gone.** It exposed `assets/*` to `<all_urls>`, which let any
  website detect this extension and read its files — a poor trade for a tool whose point is that
  data stays on the machine. It turned out to be unnecessary: the reader is opened from an extension
  page and the CSL assets are fetched same-origin by the service worker. All 23 E2E tests, including
  the five that drive the PDF reader, pass without it, and a new test keeps the list empty.

### Fixed

- **A hung DOI lookup no longer hangs the UI.** `fetchCsl` had no timeout, so an unresponsive
  doi.org left the import button spinning forever and kept the service worker awake. It now aborts
  after 15s and says so.
- **A failing anchor strategy no longer abandons the chain.** `resolveWebAnchor` guarded
  `textPosition` with try/catch but not `textQuote`, so an exception in the *first* strategy skipped
  the two fallbacks that exist precisely for that case — a note that text-position could still have
  found was reported as lost.
- **The merge no longer rewrites unrelated ids.** Every imported event's `entityId` was remapped
  through the *document* dedup map, but `entityId` means a user for a `member` event and a thread for
  a `comment` one. Only the kinds that point at a document are remapped now.
- **A DOI import says where it came from.** It recorded `source: 'manual'`, so the References view's
  ORIGIN column called a fetched record hand-entered. `ReferenceSource` gained `importedByDoi`.
- **A stalled database upgrade is visible.** `openDB` had no `blocked` / `blocking` handlers, so an
  upgrade waiting on another connection simply hung. It now warns, and yields its own connection
  when another context needs to upgrade.

### Added

- **The side-panel status menu is usable from the keyboard.** It opens focused on the current status;
  ↑/↓ walk the pipeline, Home/End jump to its ends, Tab closes it. It had `role="menu"` and none of
  the behaviour that makes the role true.

### Notes

- 241 unit tests + 24 E2E, all green. The new tests are the interesting part: the fallback chain is
  now pinned by a test that feeds it a quote selector which cannot match, and the manifest's
  emptiness is asserted rather than assumed.

## [0.23.0] — 2026-07-24

### Added

- **The extension has icons.** It shipped without any, so Chrome drew the default puzzle piece in the
  toolbar, the extensions page and the side-panel header — and a 128×128 icon is mandatory for a Web
  Store listing, so this blocked distribution rather than merely looking unfinished.
  - `src/assets/icons/icon.svg` is the source: the dashboard wordmark's glyph, filled rather than
    outlined so it survives 16px, in the app's single accent.
  - `icon-small.svg` draws the two toolbar sizes. The full icon's second rule is shorter and
    lighter, and at 16px it disappears entirely — the small variant carries two equal rules on a
    tighter margin. Same motif, drawn for the size it is actually seen at.
  - The PNGs are generated from the SVGs by rendering them in Chromium, so the icon and the UI
    cannot drift apart through a hand-typed hex.
- An E2E test asserts the manifest declares all four sizes **and that each declared file really
  loads** — a manifest can name an icon that was never built, and Chrome then falls back to the
  puzzle piece without saying anything.

## [0.22.0] — 2026-07-24

### Security

- **A crafted snapshot could inject HTML into the extension's own pages.** Record ids arrived from an
  imported file unvalidated and were interpolated raw into `data-id` attributes, so an id such as
  `x"><img src="https://…">` closed the attribute and opened an element of the sender's choosing.
  Reproduced before the fix: the element rendered and **the page fetched a remote image**, which for
  a tool whose promise is that nothing leaves the machine is the whole problem. MV3's CSP did block
  script — an inline handler was refused with `script-src 'self'` — so this was HTML injection with
  phishing and beacon potential, not arbitrary code execution. Snapshots are made to be shared
  between collaborators, so the input was always going to be someone else's.

  Closed at both ends:
  - **The import boundary** (`src/core/snapshot/validate.ts`, new) validates and normalises every
    record before a write is planned: ids must match `/^[\w.:@+-]{1,128}$/`, statuses, roles and
    activity kinds must be in their enums, file contents must be base64, and dates are normalised to
    UTC. Import fails closed and names what is wrong — a snapshot that cannot be trusted in part
    cannot be trusted in whole. `planMerge` validates too, so no caller can route around it.
  - **The sinks**: every id interpolated into an attribute is escaped, and the three places that
    build a `querySelector` from an id use `CSS.escape`. Escaping alone would not have been enough —
    no amount of HTML-escaping makes `[data-id="x\"><img>"]` a valid selector.

### Fixed

- **An imported timestamp with an offset could make an older record win the merge.** `isNewer`
  compares ISO strings lexicographically, so `12:00+02:00` (10:00Z) sorted *after* `11:00Z`. Imported
  dates are now normalised to UTC at the boundary.
- **A status outside the pipeline silently hid a source.** The Kanban renders known statuses only, so
  an imported `status: "archived"` removed the source from every column. Such a file is now refused.

### Notes

- 240 unit tests (up from 226) + 22 E2E. The new E2E is the reproduction itself: it imports the
  hostile snapshot, asserts both preview and import fail closed, and then asserts the injected
  element is absent **and that the page made no request to the attacker's host**.
- Found by a full-codebase audit, not by a user report. The side panel was never affected — it builds
  its DOM through `dataset` and `textContent`, which is the pattern the other surfaces should follow.

## [0.21.1] — 2026-07-24

### Fixed

Three icon-sizing defects, found by screenshotting every view rather than by a test — none of them
is something an assertion would have caught:

- **Documents**: the "open source" DOI link rendered its arrow at ~60px, four times the row height.
  An inline SVG with no size rule takes its intrinsic size, and `.btn svg` did not reach a bare `<a>`.
- **Style editor**: the ✕ that forgets an imported base style showed even when the base style was a
  vendored one. `.btn` sets `display`, which overrides the `hidden` attribute — `[hidden]` is now
  enforced globally, so the whole class of bug is closed rather than this one instance.
- **PDF reader**: the annotation card's anchor chip rendered its pencil at ~40px, pushing the label
  out of the chip.

## [0.21.0] — 2026-07-24

### Added

- **Pick a status in the side panel instead of cycling it.** The reading list's status button opened
  nothing and only ever moved a source *forward*, so a mis-click could not be undone from the panel
  at all — the pipeline runs one way. It now opens a menu of the whole pipeline with the current
  position marked, and a source can move back.

### Changed

- **Dev dependencies audited and upgraded — 6 vulnerabilities (2 critical, 1 high) to 0.** They were
  never in `@crxjs` as this file previously claimed: they came from the `vite`/`esbuild` chain that
  **vitest** pulls in. `vite` 6.0 → 6.4.3, `vitest` and `@vitest/coverage-v8` 2.1 → 3.2.7.
- **`@crxjs/vite-plugin` 2.0.0-beta.28 → 2.7.1** — it has left beta, which was the stated condition
  for revisiting it. The built manifest, permissions and web-accessible resources are unchanged, and
  all 21 E2E tests pass against the new build.

### Fixed

- A test that failed roughly one run in three, and had done since v0.18.0: it asserted an encrypted
  snapshot did not contain the string `d1`, but a two-character string turns up in random base64
  often enough to fail by chance. It now checks for a payload string that cannot occur in base64.
- The status menu no longer vanishes mid-click. It closed on any scroll of the panel body, and a
  late layout shift fires one — under a loaded test run that snatched the menu away between the
  locator resolving and the click landing. It now follows its button instead, and closes only when
  the button scrolls out of view.

### Notes

- 226 unit tests + 21 E2E, all green; each flake above was chased to its cause and fixed at the
  source rather than papered over in the test.
- **OFL web fonts stay unbundled.** The stacks name macOS faces (Iowan Old Style, iA Writer Mono)
  and fall back gracefully; bundling substitutes would change the typography for the people who
  already have the real ones, to help those who do not. That is a design decision, not a chore, and
  it is not one to make silently in a maintenance pass.

## [0.20.0] — 2026-07-24

### Added

- **Snapshot imports say what they will do before they do it.** Choosing a file no longer merges it:
  the snapshot is read, planned against what is already here, and the plan shown — how many sources,
  notes, references and threads would arrive, how many records would be folded into what you already
  have **by DOI**, and how many would be skipped because your copy is newer. Import or Cancel.
  A snapshot that changes nothing says so, and the Import button is disabled.
  - `planMerge` now works the merge out without performing it, and `mergeSnapshot` applies the plan
    it produces. Preview and import share the one code path deliberately: a preview that could
    disagree with the import would be worse than no preview at all — a test asserts they are equal.
  - New message `snapshot/preview`; `MergeReport` gained `newProject`, so the panel can say
    *Create* rather than *Merge into* when the project is new to this browser.

### Fixed

- The snapshot-encryption tests no longer flake under a loaded parallel run: 600k PBKDF2 iterations
  are deliberately slow and six derivations went past Vitest's 5s default. The timeout was raised
  rather than the iteration count lowered — weakening the parameters would have tested nothing.

### Notes

- 226 unit tests (up from 222) + 20 E2E; the new E2E previews a real file through the browser's file
  chooser, proves nothing was written, cancels, then imports for real and finds the new source.
- "Remember the last export folder" is dropped from the polish list: Chrome owns the download
  location, and the `downloads` permission would buy a preference that MV3 does not honour anyway.

## [0.19.0] — 2026-07-24

### Added

- **Import a third-party `.csl` file as a base style.** The editor could already
  export a compiled style; this is the way back in.
  - `src/core/citation/parse.ts` — validates a file before it is stored and refuses it with a reason
    a person can act on: not CSL, wrong namespace, a **dependent style** (a pointer to another style,
    which citeproc cannot format with), or no citation rules in it. It also reads the `<title>` for a
    default name and the declared `citation-format`, so the picker labels the style honestly instead
    of guessing its citation system.
  - IndexedDB **schema v5**: a `customBaseStyles` store. Ids are `custom-base:<slug>`, so an id says
    where a style came from, and re-importing the same style replaces it — what someone updating a
    journal's style file expects.
  - `src/core/usecases/base-styles.ts` and messages `baseStyles/list|import|delete`.
  - **Style editor**: an *Import .csl* button beside the base-style picker, imported styles grouped
    under an **Imported** heading, and a button to forget one. The live citeproc preview formats
    through the imported file immediately.

### Fixed

- A re-imported style is actually used. citation-js caches its citeproc engines by template name and
  offers no way to evict one, so re-registering a changed file under the same name kept formatting
  with the old engine. Imported styles are now registered under a name carrying a **hash of the XML**:
  a changed file is simply a different template. (Found by a test written for the update path, not in
  the field.)

### Changed

- Deleting an imported base style leaves the citation profiles built on it alone. They keep pointing
  at it, the picker marks the base style *missing*, and formatting degrades to an empty compile —
  deleting someone's profiles because a base style went away would be the worse surprise.

### Notes

- 222 unit tests (up from 206) + 20 E2E; the new E2E imports a real `.csl` through the browser's file
  chooser, watches the preview format through it, reloads to prove it persisted, and forgets it again.

## [0.18.1] — 2026-07-24

### Changed

- **The service worker is 45% smaller: 1.15 MB → 631 kB (213 kB → 151 kB gzipped).** The six
  vendored CSL styles are ~520 kB of XML — Chicago notes alone is 243 kB — and every cold start
  parsed the lot whether or not a citation was ever formatted. They are now emitted as separate
  extension assets (`?url`) and fetched on first use, cached for the worker's lifetime. An APA
  session never touches the Chicago file.
- **BREAKING (internal port)** — `CitationFormatter`'s four methods return promises now, because
  loading a style is I/O and pretending otherwise would only hide it. `formatPreview` follows.
  Same-origin extension assets need no `web_accessible_resources` entry, so the manifest is
  unchanged.
- `CiteJsFormatter` takes a `CslLoader` — one function, `(template) => Promise<string | undefined>`.
  Production fetches (`src/adapters/citation/csl-assets.ts`); tests read the same files from disk
  (`test/support/csl-loader.ts`). `BASE_CSL` is gone with the static imports that fed it.

### Notes

- 206 unit tests (up from 201) + 19 E2E, all green; five of the new ones pin the laziness itself —
  that only the style in play is loaded, that it is loaded once, and that a miss is remembered
  rather than retried.
- Citation output is unchanged: the golden tests (4 base styles × author counts) still match
  character for character.

## [0.18.0] — 2026-07-24

### Added

- **Snapshot export & import (Phase 5, M4)** — the file-based half of collaboration, and the last
  milestone of the roadmap:
  - `src/core/usecases/snapshot.ts` — `buildSnapshot` collects the whole project (sources, notes,
    references, styles, people, history and discussion); `mergeSnapshot` folds one back in.
    **PDF bytes are opt-in**: they dwarf everything else, and a snapshot you cannot send is not a
    way of sharing work.
  - `src/core/snapshot/envelope.ts` — the file format. An **empty password gives plain JSON**
    (readable, diffable, the point of a local-first backup); a password seals the payload with
    **AES-GCM** under a **PBKDF2-SHA-256** key (600k iterations, fresh salt and IV per export).
    Import detects which kind it is holding, so the user never declares it. `projectName` and
    `exportedAt` stay in the clear, so an encrypted file is still identifiable.
  - A `format` number in every envelope: a build refuses a **newer** snapshot rather than mangling
    it, and says so.
  - **Merge rules.** Documents and references dedup **by DOI** — the roadmap's hard rule — and the
    folded id is **remapped**, so annotations, references and threads that pointed at the incoming
    copy end up on the record that was already here. Everything else merges by id with the newer
    `updatedAt` winning; project members are unioned. Nothing is ever deleted by an import.
  - New messages `snapshot/export` and `snapshot/import`; both halves record a `sync` activity
    event — the last of the seven kinds to come into use.
- **Team → Sync** tab: the sync-mode selector (**Local only** / **File-based**, with **Self-hosted
  backend** shown as *Unavailable* rather than pretended), export with an optional password and an
  "Include PDF files" checkbox, and import with a file picker. `Project.syncMode` persists the choice.

### Changed

- README and `doc/roadmap.md` now say the roadmap is delivered; `doc/data-model.md` documents the
  snapshot format and every merge rule.

### Notes

- 201 unit tests (up from 181) + 19 E2E; the new E2E exports a real file through the browser's
  download path, switches sync mode and proves it survives a reload, then imports a snapshot whose
  source carries a DOI the project already has — and shows one row, not two.
- Presence, the one Phase 5 goal not delivered, needs a live channel between clients. A file-based
  mode cannot provide one, and a backend is out of scope for this repo.

## [0.17.0] — 2026-07-24

### Added

- **Comment threads (Phase 5, M3)** — anchored discussion, the third of the mock's tabs:
  - `CommentThread` in `src/core/model/types.ts` with **embedded comments**: the UI only ever reads a
    thread whole, so a reply is one atomic write and there is no second store to keep in step.
  - IndexedDB **schema v4**: a `commentThreads` store indexed `byProject` and `byDocument`.
    `migrations[1]`–`[3]` untouched.
  - `src/core/usecases/comments.ts` — `startThread` / `replyToThread` / `setThreadResolved` /
    `deleteThread` / `listThreads`, plus `sortThreads` (open first, newest first within each group).
    An empty comment is refused; a resolved thread takes no further replies.
  - New messages `comments/listByProject|start|reply|setResolved|delete`.
  - **Team → Comments**: thread cards with the anchor chip, the quoted passage, a resolve pill and a
    reply box. The tab's counter shows **open** threads only — a resolved thread is not a to-do.
  - **Annotations → Discuss** starts a thread on a note, inheriting its document, quote and anchor
    label, and says where the thread went.
- Every thread change records a `comment` activity event — the kind M2 defined and left unused, so
  the feed's filter chip appeared on its own.

### Changed

- **README rewritten** — it still claimed "Phase 1 MVP in progress" four phases later. It now
  describes what the extension actually does, the local-first posture, the test commands and where
  the documentation lives.
- `doc/data-model.md` gained `StoredFile`, `ActivityEvent` and `CommentThread`, plus a table of the
  four persisted schema versions.

### Notes

- 181 unit tests (up from 168) + 18 E2E; the new E2E starts a thread from an annotation, replies,
  resolves, reloads to prove persistence, and finds both steps in the activity feed.

## [0.16.0] — 2026-07-24

### Added

- **Activity feed (Phase 5, M2)** — the project now remembers what happened, with before→after
  diffs, as the roadmap's change tracking requires:
  - `ActivityEvent` in `src/core/model/types.ts` with seven kinds — `source`, `status`,
    `annotation`, `comment`, `reference`, `member`, `sync`. `comment` and `sync` are defined for
    M3 / M4 and emitted by nothing yet; the filter chips are built from the kinds actually present.
  - IndexedDB **schema v3**: an `activity` store with a composite `byProjectTime`
    (`[projectId, createdAt]`) index, so a project's newest events are read without sorting in
    memory. `migrations[1]` and `[2]` untouched.
  - `src/core/usecases/activity.ts` — `recordActivity` (best-effort: **never throws**, because the
    feed records a change and must not undo one) plus the builders that decide whether an event is
    worth writing at all: a status move yes, a metadata edit no.
  - Recording happens in the router cases, where the change actually lands, so a status moved from
    the side panel and an annotation added in the PDF reader reach the feed without either surface
    knowing it exists.
  - New message `activity/listByProject` (newest first, `limit` pages the feed at 200).
- **Team view tabs — Activity | Members.** The Activity tab groups events by day (Today /
  Yesterday / date), draws the timeline from the design mock, filters by kind and shows a
  `Show older` button once a full page has been read. Comments joins them in M3; no dead tabs.

### Changed

- `SELF_USER_ID` moved from `src/options/main.ts` into `src/core/model/identity.ts` — the router
  stamps it on every event, so it is no longer a dashboard-private constant.
- The dashboard's HTML escaping (`esc`) now comes from `escapeHtml` in `src/options/view-model.ts`,
  which `highlightEntity` reuses: a summary is escaped **before** the entity inside it is
  emphasised, so a document title can never inject markup.

### Notes

- 168 unit tests (up from 139) + 17 E2E; the new E2E moves a source through the service worker and
  finds the event in the feed with its `To read → In review` chips, then filters it away by kind.
- Retention is a read limit, not a purge: every event is kept, so the M4 snapshot can carry the whole
  history. The feed reads 200 at a time and `Show older` asks for the next page.

## [0.15.0] — 2026-07-24

### Added

- **Team view — members & roles (Phase 5, M1)**, the sixth dashboard nav item and the end of the
  Phase-2 "Team is deferred" note:
  - `src/core/model/roles.ts` — the capability matrix from the design mock as data (`can(role,
    capability)`), plus `keepsAnOwner()`, the guard that stops a project losing its last owner.
  - `src/core/usecases/members.ts` — `listMembers` / `inviteMember` / `setMemberRole` /
    `removeMember`. `Project.members` is authoritative for roles and `User.rolesPerProject` is
    written in the same use-case, so the two cannot drift.
  - Team view: member list with avatars, role selects and removal, an invite popover (email + role),
    and the full capability matrix rendered from the same table the logic uses.
  - New messages: `members/list|invite|setRole|remove`, `users/list|put`.
- `ProjectMember.pending` — an invited member who has not accepted yet, shown as an **Invited** badge.

### Changed

- The Team view opens with a plain statement that **roles are advisory**: every collaborator holds a
  full copy of the project in their own browser, so nothing enforces a role, and this build has no
  backend that could. The scope decision for Phase 5 is local-first — no server is being built.

### Notes

- 139 unit tests (up from 118) + 16 E2E; the new E2E invites a member, changes their role, reloads to
  prove persistence, and removes them again.
- The last owner's role control is a static badge rather than a select — the guard is enforced in the
  use-case too, so the UI is not the only thing holding the invariant.

## [0.14.0] — 2026-07-24

### Added

- **Full-screen CSL style editor (Phase 4, M2–M4)** — the dashboard's "Full editor" button now opens
  the workspace from `citation-style-editor.html` instead of a "coming in Phase 4" toast:
  - A `styleEditor` route that drops the app shell (sidebar + credit footer) the way the PDF reader
    does, with a profile rail, an editable style name, a base-style picker, and a preview panel.
  - Five grouped rule sections — **Citation system**, **Authors** (max authors, names before
    "et al.", final joiner), **Identifiers** (DOI, DOI-as-URI, URL fallback), **Formatting** (issue
    number, page-range label) and **Special sources** (FOI, legal-case templates).
  - **Live preview** formatted by real citeproc in the service worker (`citations/preview`) over
    five sample sources — journal articles with one and four authors, a dataset, an FOI request and
    a legal case. Debounced, with a sequence guard so a slow response can't overwrite a newer one.
  - **CSL override** tab: the generated override object, syntax-highlighted by a hand-rolled
    highlighter (`src/options/csl-code.ts` — MV3's CSP rules out a CDN library).
  - **Export .csl** downloads the compiled style (`citations/compiledCsl`), plus **Duplicate**,
    **New style** and per-profile delete (`citationStyles/delete`).
- **Chicago (notes & bibliography)** vendored as a base style, so the "footnote" citation system is
  real rather than a label on an author–date style.
- Rule compilation gained the remaining levers: a **page-range label** (`p.` / `pp.`, injected into
  the CSL as a `<label>` because citeproc re-formats the `page` variable), **DOI as `doi:…`** vs a
  full URI, and the **FOI / legal-case** templates (report genre, court and neutral citation).

### Changed

- **BREAKING (internal port)** — `CitationFormatter` gained `compileStyle(style)`.
- The citation **system is no longer an independent toggle**: it is declared by the base CSL style
  (`<category citation-format="…"/>`), so choosing Author–date / Footnote / Numeric now switches the
  base style, and `BASE_STYLES` is asserted against the vendored CSL files so the two can't drift.
  The seeded "Chicago" profile therefore moves to the notes base style, where it always claimed to be.
- Copying a citation from Documents, References or the project bibliography now passes the active
  profile's `styleId`, so user rules shape the copied text — previously only the base template did.
- The compact Citation-styles view swapped its hand-rolled preview for the same citeproc-backed one,
  and its system toggle for a base-style picker.

### Notes

- 118 unit tests (up from 95) + 15 E2E; the new E2E drives the editor end to end (rule change →
  preview moves → CSL tab agrees → save → survives reload).
- The service-worker bundle grows to ~1.15 MB (213 kB gzipped) from vendoring the Chicago notes CSL.

## [0.13.0] — 2026-07-24

### Added

- **Rule-driven CSL citation engine (Phase 4, M1)** — `CitationStyle.userRules` now actually change
  citeproc output, instead of only being stored:
  - `src/core/citation/compile.ts` — pure compilation of a base CSL style plus user rules:
    `compileCsl()` injects the citeproc-honored `and`, `et-al-min`, `et-al-use-first` and
    `et-al-use-last` attributes onto every `<name …>` element; `applyRulesToItem()` strips
    `DOI` / `URL` / `issue` from a CSL-JSON item per the inclusion rules; `overrideObject()` builds
    the human-readable JSON override shown in the editor's code view.
  - `CitationFormatter.formatWithStyle(items, style, kind)` — formats through a full style. The
    compiled style is registered with citation-js under a stable `custom:<hash(rules)>` name and
    cached per formatter instance.
  - All five base CSL styles are now vendored under `src/assets/csl/` (APA, Harvard, Vancouver were
    previously taken from the citation-js bundle; Chicago and MLA were already vendored), which is
    what makes runtime compilation of custom styles possible.
  - New `citations/preview` message — formats ad-hoc CSL-JSON samples through a style without
    persisting anything; powers the editor's live preview.
  - `citations/bibliography`, `citations/reference` and `citations/document` accept an optional
    `styleId`; the router resolves it to a `CitationStyle` and formats with its rules.

### Changed

- **BREAKING (internal port)** — `CitationFormatter` gained a required `formatWithStyle` method, so
  any adapter implementing the port must provide it. No user-facing behaviour changes when no
  `styleId` is passed: the plain base-template path is unchanged.

### Notes

- 95 unit tests (up from 83): 8 for the pure compiler and 4 golden tests asserting that rules drive
  real citeproc output (author truncation, DOI removal, issue removal, in-text shape).
- No UI yet — the dashboard's "Full editor" button and its hand-rolled preview are M2/M3.

## [0.12.0] — 2026-07-23

### Added

- **PDF ingestion UX (Phase 3, M5)** — the last Phase 3 milestone:
  - Dashboard **"Add PDF"** (Documents view): upload a local PDF → the bytes are stored (`files/put`),
    a `type:'pdf'` document is created (`documents/put`), and the reader opens on it.
  - **"Open in reader"** action on any PDF-capable document row. If the document has a stored file it
    opens straight away; if its URL is a PDF, the bytes are fetched behind an optional host-permission
    grant, cached, and then opened.

### Notes

- This completes Phase 3: file storage + PDF anchoring core, a pdf.js reader, text and region
  anchoring with a persistent annotations rail, and dashboard ingestion.
- E2E: "Add PDF" uploads a file, creates a pdf document, and opens the reader (14 E2E specs total).

## [0.11.0] — 2026-07-23

### Added

- **Region anchoring (Phase 3, M4)**: in **Region** mode, drag a rectangle over the page to anchor a
  figure/table/region. A live rubber-band shows the selection; releasing pops the Anchor / Note
  toolbar and stores the rectangle as a fraction-rect anchor (no quote), rendered as a bordered
  `.ov.region` overlay with a corner label and listed in the rail as a Region card. Persists and
  re-anchors across zoom, page changes, and reload like text highlights.

### Notes

- E2E: dragging a rectangle in Region mode anchors it and the overlay survives a reload (13 E2E specs).

## [0.10.0] — 2026-07-23

### Added

- **PDF text anchoring + annotations rail (Phase 3, M3)**:
  - A pdf.js **text layer** over each page makes text selectable; selecting text pops a floating
    toolbar (Highlight / Note) that anchors the selection via `createPdfAnchor` and persists it
    (`annotations/put`).
  - **Overlays**: anchored highlights render as positioned overlays resolved from the stored fraction
    rects, so they track zoom and page size; clicking one focuses its rail card (and vice-versa).
  - **Annotations rail**: per-page / all-pages scope, cards showing the locator, quoted text, a live
    **note** textarea (debounced save), a review-**status** select, tags, and delete — wired to
    `annotations/listByDocument` / `annotations/put` / `annotations/delete`.

### Notes

- Per-annotation "section" and the link-to-section popover from the mock are omitted — the domain
  `Annotation` has no section field (unchanged this milestone).
- E2E: a stored anchor renders as an overlay + rail card and note/status edits persist across reload;
  a real text selection → Highlight creates a persisted anchor (12 E2E specs total).

## [0.9.0] — 2026-07-23

### Added

- **PDF reader surface (Phase 3, M2)**: a standalone, web-accessible extension page
  (`src/pdfviewer/`, opened as `…/src/pdfviewer/index.html?documentId=…`) that renders a stored PDF
  with **pdf.js** — canvas rendering, page navigation, and zoom (75–175%), with a toolbar (back to
  dashboard, document identity, Text/Region mode toggle, page + zoom clusters) and the annotations
  rail scaffold. Ported the reader's design tokens/components into `pdfviewer.css`.
- `pdfjs-dist` bundled locally with its **ESM worker** (no eval → the default MV3 CSP is untouched);
  the viewer HTML is declared as a Rollup input and the worker/assets are web-accessible.

### Notes

- The viewer is a full-screen workspace, so it carries **no credit footer** (per the skip rule).
- E2E: a minimal PDF fixture is seeded via `files/put` and the reader renders it to a canvas with no
  worker/CSP console errors (10 E2E specs total).

## [0.8.0] — 2026-07-23

### Added

- **PDF anchoring foundation (Phase 3, M1)** — no UI yet:
  - IndexedDB **schema v2**: a new `files` store for binary payloads (PDF bytes), reached via a new
    `FileRepository`. `migrations[1]` is untouched; `migrations[2]` appends the store.
  - Pure **PDF anchoring core** (`src/core/anchoring/pdf.ts`) mirroring the web anchoring module:
    `createPdfAnchor` / `resolvePdfAnchor` store rectangles as **fractions (0–1) of the page box**, so
    anchors are invariant to zoom and render DPR. Unit-tested (round-trip + zoom-invariance).
  - Messages `files/put` / `files/get` (bytes cross the messaging boundary as **base64**, since
    `chrome.runtime.sendMessage` is JSON-serialised), plus `annotations/listByDocument` and
    `annotations/delete`. Router cases + tests.
  - `'pdf'` added to `DocumentType`; a `StoredFile` model type.

### Notes

- 83 unit tests (base64 round-trip, PDF anchoring, new router routes, schema-v2 store list).

## [0.7.0] — 2026-07-23

### Added

- **Citation styles view (Phase 2, M6)**: a two-column styles workspace — a list of style profiles
  (APA, Chicago, Harvard seeded on first run) and a lightweight rule editor: citation system
  (author–date / footnote), a maximum-authors stepper, and Include DOI / URL / issue toggles, with a
  **live preview** that reformats one- and four-author samples as the rules change.
- Create new style profiles and **Save** edits, persisted via the new `citationStyles/put` message.
- A "Full editor" affordance flags the complete CSL rule editor coming in Phase 4.

### Notes

- This completes the Phase 2 core: Dashboard shell, Overview + Kanban, Documents, References + DOI
  import, Annotations, and Citation styles. Team and the full CSL editor remain deferred by design.
- 71 unit tests and 7 dashboard E2E specs (shell, routing, Documents filter, References + import
  form, Annotations review status, Kanban keyboard move, and a persisted citation-style edit).

## [0.6.0] — 2026-07-23

### Added

- **Annotations view (Phase 2, M5)**: a searchable, filterable list of the project's notes — each
  card shows the anchor locator (a quote snippet or PDF page), the source document line, the quoted
  note body, a review-status tag, and its tags, plus a **Cite** action that copies the source's
  citation.
- **Review workflow**: the status tag opens a popover to move a note through
  draft → accepted → in report → rejected, persisted via the new `annotations/put` message.
- Filter chips for All / Draft / Accepted / In report / Rejected.

### Notes

- 71 unit tests (router `annotations/put` round-trip) and a new E2E asserting a review-status change
  persists across a reload.

## [0.5.0] — 2026-07-23

### Added

- **References view + DOI import (Phase 2, M4)**: a table of the project's bibliographic records —
  formatted reference line, DOI, a CSL type chip, an origin tag (Extracted / Zotero / Manual), the
  "used in" outputs, and a copy-citation action (via `citations/reference`).
- **Import by DOI**: a use-case (`importReferenceByDoi`) resolves a DOI to CSL-JSON through doi.org
  content negotiation and stores it as a Reference, deduping by DOI. The import popover offers DOI
  today (gated behind an optional host-permission request for doi.org / crossref / datacite);
  Zotero / BibTeX / RIS are shown as "Soon".
- Messages `references/listByProject`, `references/put`, `references/importByDoi` (router + tests).
  No schema change — the `references` store already exists.

### Notes

- 71 unit tests (new `references` use-case suite + router coverage) and a new E2E asserting the
  References table renders and the DOI import form opens.

## [0.4.0] — 2026-07-23

### Added

- **Documents view (Phase 2, M3)**: a searchable, filterable table of the project's sources — live
  search over title/author/DOI, status filter chips with live counts, per-row Section chip, a Status
  pill that opens the shared "Move to" popover, a notes count, and an external-link action to the
  source's DOI. Empty and no-match states included.

### Notes

- Reuses the side-panel pure view-model (`filterDocuments`, `statusCounts`) — no duplicated logic.
- New E2E asserting the Documents search filters the table.

## [0.3.0] — 2026-07-23

### Added

- **Overview + Kanban board (Phase 2, M2)**: the Overview route now shows four project stat tiles
  (Sources, Analysed with % of corpus reviewed, Annotations with count included in the report, and
  the active citation Style) above a four-column workflow **Kanban board**.
- Kanban cards move between workflow stages by **drag-and-drop** and by **keyboard** (focus a card,
  ← / → to advance/retreat, Enter to open the status popover); moves persist via `documents/put`
  and update the tiles, with a flash highlight and a toast.
- Shared **status popover** ("Move to") that flips to stay on-screen, reused by later views.
- **Export bibliography** action copies the project bibliography to the clipboard via
  `citations/bibliography`.
- Read-only messages `annotations/listByProject` and `citationStyles/list` (router + tests) powering
  the annotation/style tiles and the nav count badges. No schema change — the stores already exist.

### Notes

- 64 unit tests (router coverage for the two new routes) and a new E2E asserting a keyboard Kanban
  move persists across a reload.

## [0.2.0] — 2026-07-23

### Added

- **Dashboard app-shell (Phase 2, M1)** on the options page: sidebar with wordmark, project
  switcher (lists projects, switches active, creates new ones) and a Workspace nav (Overview,
  Documents, Annotations, References, Citation styles) with live count badges; sticky topbar with
  per-route title/subtitle; a view router; and a responsive off-canvas drawer (≤880px) with scrim
  and Escape-to-close.
- Dashboard-local design system in `src/options/dashboard.css` — the full token + component set
  ported from the design mock (warm-neutral light theme, terracotta accent, print-scholarly type).
  The side panel's `panel.css` is untouched.
- Pure, unit-tested dashboard view-model (`src/options/view-model.ts`) reusing the side-panel status
  vocabulary; routes, titles and status colours (6 new tests, 62 total).
- **Credit footer** on the dashboard (not the side panel): attribution segments + app version read
  from the manifest at runtime.
- E2E coverage: the dashboard loads in headed Chromium, the project switcher shows a seeded project,
  and nav routing updates the topbar title.

## [0.1.1] — 2026-07-23

### Added

- End-to-end tests (Playwright) that load the built extension into a headed Chromium: the side
  panel renders and seeds a default project, and a filed document flows through
  messaging → router → IndexedDB → UI with updated progress.
- CI job running the E2E suite under xvfb.

### Notes

- Credit-footer decision: placed on the Phase 2 Dashboard only, not the space-constrained side
  panel.

## [0.1.0] — 2026-07-23

### Added

- **Side Panel UI** ported from the design prototype: capture card, reading list grouped by
  workflow status with search and status filter, and a review-progress footer — wired to the
  service worker and IndexedDB.
- First-run seeding of a default project; capture the active tab into the reading list
  (deduplicated by DOI).
- One-click citation copy: in-text/bibliography for the filed page, per-source in-text citation
  from the list, and a project-wide bibliography.
- Shared design tokens and component styles extracted to `panel.css`; accessibility preserved
  (roles, keyboard, reduced-motion) with stable `data-od-id` hooks.
- `citations/document` message to cite any listed source. Pure side-panel view-model
  (filter/group/progress) unit-tested (56 tests total).

### Notes

- Bundling OFL web fonts (serif display + mono) for cross-platform visual fidelity is a tracked
  follow-up; the current stack degrades gracefully.

## [0.0.5] — 2026-07-23

### Added

- Citation formatting via citeproc-js (bundled locally through citation-js): `CitationFormatter`
  port and `CiteJsFormatter` adapter, with the en-US locale bundled.
- Five base styles: APA, Harvard, and Vancouver (built-in) plus Chicago author-date and MLA
  (vendored CSL under `src/assets/csl`, registered at runtime).
- Citation use-cases (`formatProjectBibliography`, `formatReferenceCitation`) and
  `citations/bibliography` / `citations/reference` messages, formatting from stored `cslData`.
- Golden-file tests pinning exact output for 4 styles × 1/3/4-author references (48 tests total).

### Changed

- Router now takes structured deps (`{ capture, formatter }`); the service worker injects the
  citeproc formatter.

## [0.0.4] — 2026-07-23

### Added

- Pure bibliographic metadata extraction: DOI detection/normalisation, `citation_*`/Dublin Core
  meta-tag reading, year parsing, and CSL-JSON building.
- Web-page anchoring (`createWebAnchor`/`resolveWebAnchor`) using the W3C model — text-quote →
  text-position → css fallback — via the Hypothesis `dom-anchor-*` libraries; re-anchors after
  content shifts.
- Capture use-case: builds a Document + linked Reference and deduplicates by DOI within a project
  (deterministic, injected id/clock).
- `capture/page` message wired through the router; self-contained page scanner injected into the
  active tab (`activeTab` + `scripting`, no persistent host access) plus side-panel capture glue.
- Tests: metadata, anchoring (jsdom, incl. re-anchor), page scan, and capture dedup (31 tests total).

## [0.0.3] — 2026-07-23

### Added

- Typed message contract (`MessageMap`) shared by UI and service worker.
- Pure message router (`handleRequest`) dispatching requests to repository operations,
  unit-tested independently of `chrome.*`.
- `chrome.runtime` messaging adapter: typed `sendRequest` client and `registerMessageRouter`
  server binding, with lazy cold-start repository resolution.
- Service worker wired to the router with a cached IndexedDB handle.
- Round-trip tests over a mocked `chrome.runtime` (write→read a document end to end); 17 tests total.

## [0.0.2] — 2026-07-23

### Added

- Domain-core model types mirroring the data model (Project, Document, Annotation,
  Reference, CitationStyle, User), including the multi-strategy `Anchor` (web + PDF).
- Repository ports (storage contract) with no IndexedDB/`chrome.*` leakage.
- IndexedDB adapter via `idb`: versioned schema, ordered migrations, object stores and
  indexes (incl. `[projectId, metadata.doi]` for capture-time deduplication).
- DOI-aware `findByDoi` for documents and references (case- and `doi.org`-prefix insensitive).
- Unit tests (`fake-indexeddb`): CRUD, project isolation, DOI dedup, migration ordering (11 tests).

## [0.0.1] — 2026-07-23

### Added

- Initial project scaffold: MV3 manifest via `@crxjs/vite-plugin`, TypeScript (strict), Vite build.
- Background service worker, side panel, and options-page stubs.
- Domain-core seed (`workflow` statuses) with Vitest unit tests.
- Tooling: ESLint (flat config), Prettier, EditorConfig, Vitest + v8 coverage.
- GitHub Actions CI: typecheck → lint → unit → build.

[Unreleased]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.21.1...v0.22.0
[0.21.1]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.5...v0.1.0
[0.0.5]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AmigoUK/Research-Chrome-Extension/releases/tag/v0.0.1
