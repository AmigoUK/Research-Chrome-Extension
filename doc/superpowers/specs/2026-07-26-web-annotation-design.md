# Web-page annotation — design (Etap B, v1)

_Date: 2026-07-26 · target release: v0.27.0 (minor — new user-visible feature)_

## Context

The audit of 2026-07-25 (`doc/audit-2026-07-25.md`) found that the product's headline
capability — notes anchored to the exact passage of a **web page** — is unreachable. The full W3C
anchoring model lives in `src/core/anchoring/web.ts` (`createWebAnchor` / `resolveWebAnchor`,
text-quote → text-position → css), built and unit-tested, but **nothing calls it**: there is no
content script and the manifest declares no `content_scripts`. Web annotations can only arrive today
via snapshot import. This spec designs the feature that makes them first-class, while keeping the
project's deliberate least-privilege stance (`manifest.config.ts` holds only `activeTab`; host access
is optional and requested per-origin).

Etap A (v0.26.0) already shipped the blocker/logic fixes; this is the one remaining audit blocker,
carved out as its own spec because it is a feature build that forces a permission-model decision.

Intended outcome: a user can select text on an ordinary web page, save a highlight or a note anchored
to it, see those highlights repaint when they return to the page, and manage the notes from the side
panel — with no standing access to every site.

## Decisions (settled in brainstorming)

1. **Activation = hybrid.** On-demand injection via `activeTab` for immediate use; on the first
   annotation on an origin, request that origin's optional host permission and
   `chrome.scripting.registerContentScripts` so future visits auto-load. Default: zero standing access.
2. **Document/project = auto-file.** The first annotation on an unfiled page silently files it
   (find-or-create `Document` + `Reference` via `capturePage`) into the **active project**, then
   attaches the note. No "file it first" step.
3. **UI = side-panel-driven.** Only a selection toolbar and highlight painting are injected into the
   page; notes are written and managed in a new side-panel **"On this page"** view. Minimal injected
   surface → fewer CSS conflicts, smaller attack surface.
4. **Scope = lean v1.** Highlight + note + review status + delete + repaint-on-revisit + "anchor lost"
   handling + jump-to-highlight. Deferred: highlight colours, tags, keyboard shortcut, an
   "annotated sites" manager, full SPA-route handling.

## Guiding principle

Maximum reuse, minimum new. Reuse `web.ts` (anchoring), the `Annotation` model (`kind: 'web'` already
exists and already round-trips through snapshot import), `capturePage` (archiving/dedup), and the side
panel (surface). **No IndexedDB schema change** — no new fields, no new indexes, so no `DB_VERSION`
bump and no migration.

## Architecture

### New components

- **`src/content/annotator.ts`** — the injected content script (ISOLATED world). Responsibilities,
  and _only_ these:
  - Paint highlights for the page's resolved anchors, and show a floating selection toolbar
    (Highlight / Note). All injected UI lives inside a **shadow-DOM root** appended to `document.body`
    so page CSS cannot touch it and it cannot touch the page.
  - Highlights are `position: absolute` overlay rects computed from `range.getClientRects()`, held in
    the shadow layer, repositioned on scroll/resize. **We never wrap or mutate page nodes** — wrapping
    breaks page layout and framework reactivity.
  - Selection (`mouseup`) → build a `Range`, show the toolbar. Highlight/Note →
    `createWebAnchor(root, range)` where `root = document.body`, then message the service worker.
  - Clicking a highlight, or a "jump to" from the side panel, scrolls to and flashes the overlay.
- **`src/content/annotator.css`** — toolbar + overlay styles, inlined into the shadow root (mirrors the
  PDF reader's `seltool` visual language).

### Reused, unchanged

- `src/core/anchoring/web.ts` — `createWebAnchor` / `resolveWebAnchor` (returns `Range | null`; the
  null path is the "anchor lost" signal we surface).
- `src/core/usecases/capture.ts` — `capturePage` for find-or-create + DOI/URL dedup.
- `src/adapters/chrome/page-scan.ts` — `scanDocumentRaw` / `buildCaptureInput` to gather page
  metadata for the auto-file.
- The `Annotation` model and `annotations/put` · `annotations/delete` routes for edit/status/delete.

### Message additions (all append-only in `messages.ts` + `router.ts`)

- **`web/annotate { input: CaptureInput; anchor: WebAnchor; withNote: boolean }`** →
  `{ documentId: Id; annotationId: Id }`. Use-case `annotateWebPage`: **find the document by URL** in
  the project (shared `findDocumentByUrl` helper — see below); if absent, create it via `capturePage`;
  then write a `web`-anchored `Annotation` through the same activity-recording path as
  `annotations/put`. Return the ids. Atomic; one feed event.
  - **Dedup by URL, not DOI.** `capturePage` dedups only by DOI (audit finding #12), so a DOI-less page
    annotated twice would spawn a second document and split its notes. `annotateWebPage` therefore does
    its own URL lookup _first_ and only falls through to `capturePage` when nothing matches — the same
    lookup `web/annotationsForUrl` uses, so the two routes always agree on "the document for this URL".
  - **No active project yet.** If the content script sent no `projectId` (fresh profile, side panel
    never opened), the use-case falls back to the first existing project, seeding a default one when the
    store is empty — mirroring `ensureSeedProject`.
- **`web/annotationsForUrl { projectId: Id; url: string }`** →
  `{ documentId: Id | null; annotations: Annotation[] }`. Uses the same `findDocumentByUrl` helper
  (`documents.listByProject(projectId)` filtered on `url` — no new index; project sizes are small),
  then `annotations.listByDocument`. Returns `documentId: null` when the page isn't filed yet.

`handleRequest` stays pure: the **content script reads the active project from
`chrome.storage.local` itself** and puts `projectId` into the message, so no `chrome.*` leaks into the
router.

### Canonical active project (closes audit finding #13)

A single canonical active project lives at **`chrome.storage.local['activeProjectId']`**, read/written
by the side panel and dashboard and read by the content script. Etap A's Fix 3 (side-panel switcher)
migrates from `storage.session` to this shared `local` key. This gives web annotation an unambiguous
target project and, as a side effect, makes "active project" consistent across all surfaces.

### Service-worker glue (not router messages — `chrome.*` lives here)

- **Activate on gesture:** side-panel "Annotate this page" → SW `chrome.scripting.executeScript` the
  annotator into the active tab (`activeTab`).
- **Per-origin opt-in:** on the first successful `web/annotate` for an origin, SW requests
  `chrome.permissions.request({ origins: ['<origin>/*'] })` and, if granted,
  `chrome.scripting.registerContentScripts([{ id, matches: ['<origin>/*'], js: [annotatorFile], world: 'ISOLATED', runAt: 'document_idle' }])`. Registrations persist across restarts. Denial is
  non-fatal: the annotation is saved; it just won't auto-repaint until the user activates again.
- **Open the side panel** on the annotate gesture (`chrome.sidePanel.open`).
- **Broadcast `web/changed { url }`** after any web-annotation write so the content script repaints and
  the side panel reloads. Both listen via `chrome.runtime.onMessage`.

## Data flows

**Annotate (new highlight/note):**
1. Selection → toolbar → Highlight/Note.
2. Content script: `createWebAnchor(document.body, range)`; scan page metadata; read `projectId` from
   `storage.local`; send `web/annotate`.
3. SW `annotateWebPage`: find document by URL (else `capturePage`), write annotation, return
   `{documentId, annotationId}`; open/focus side panel; broadcast `web/changed`.
4. Content script paints the new highlight; side panel shows the page's notes with the new one focused.

**Revisit an opted-in origin:**
1. Registered content script auto-injects at `document_idle`.
2. `web/annotationsForUrl { projectId, url }` → `{ documentId, annotations }`.
3. For each: `resolveWebAnchor(document.body, anchor)` → paint if a `Range` comes back; collect the
   `null`s as "lost". Side panel shows resolved notes plus a "Couldn't place on this page (N)" group.

## Side panel — "On this page"

A new section keyed to the active tab's URL (the panel already tracks that URL via `loadPreview`).
Lists the current document's web annotations: quote, autosaving note `textarea`, review-status select,
delete, and **jump-to** (messages the content script to scroll+flash). A separate **"Couldn't place on
this page (N)"** group lists anchors `resolveWebAnchor` could not find — the note stays editable and
deletable, and we never pretend it was placed (same honesty principle as Etap A's PDF Fix 5).

## Edge cases

- **Restricted pages** (`chrome://`, Web Store, the browser PDF viewer): injection fails; the side
  panel shows "Can't annotate this page" — an explanation, not a silent dead end.
- **Dynamic/SPA pages:** v1 resolves on load and repositions overlays on scroll/resize; re-resolving on
  route changes / large DOM mutations is deferred.
- **Style isolation:** shadow-DOM root for all injected UI; overlays in an absolutely-positioned layer.
- **Denied host permission:** annotation persists; no auto-repaint until re-activation.

## Testing

- **Unit / router (`fake-indexeddb`):** `annotateWebPage` find-or-create + write; `web/annotationsForUrl`
  returns the document's annotations and `null` when unfiled. Extend `test/core/router.test.ts`.
- **jsdom:** `web.ts` is already covered; add coverage for the overlay-from-rects and lost-anchor
  branching where DOM-testable.
- **E2E (Playwright):** a bundled fixture HTML page — activate → select → Highlight → assert an overlay;
  reload → assert repaint; edit a note in the side panel; alter the page text → assert the note lands in
  "Couldn't place on this page".

## Build risk (resolve first in the plan)

`@crxjs/vite-plugin` registers manifest `content_scripts` **statically**; we want **dynamic**
registration only. The annotator must therefore be emitted as an explicit build input (as the PDF
reader is, via `vite.config.ts` Rollup inputs) with a **stable output filename** to pass to
`registerContentScripts`. The plan's first step verifies the built file path before anything depends on
it. If crxjs cannot emit a stable standalone content-script bundle, fall back to declaring it in
`web_accessible_resources` and injecting the built URL.

## Out of scope for v1

Highlight colours; per-annotation tags; a `chrome.commands` shortcut; an "annotated sites" management
UI (revoke per-origin registration + host permission); SPA-route re-anchoring. Each can be a later
minor release.

## Release

SemVer minor → **v0.27.0** (new user-visible feature). Ship docs with it (README, `doc/STATUS.md`,
CHANGELOG, the GitHub description) per the project convention.
