# Project Status & Resume Plan

_Last updated: 2026-07-26 — **all five roadmap phases delivered**; **polish list complete**;
**v0.27.0 web-page text annotation shipped** (the one capability the audit had deferred); **v0.27.1
network/annotator hardening pass**; **v0.27.2 web annotations survive SPA navigation**; **v0.27.3
annotate inside open Shadow DOM**; **v0.27.4 quote cap + honest coarse CSS fallback**._

## Where we are

**Every roadmap phase is delivered and on `main`.** Phase 5 (Collaboration & Sync) closed at
**v0.18.0** with snapshot export/import; the roadmap's third sync mode (a self-hosted backend) stays
out of scope by an explicit decision, and the UI shows it as unavailable rather than pretending.

- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Branch state:** everything through **v0.27.4 is on `main`** (Phases 1–5 + polish + hardening +
  web-page annotation). No unmerged work.
- **Releases:** v0.27.4 quote cap + honest coarse CSS fallback; v0.27.3 annotate inside open Shadow
  DOM; v0.27.2 web annotations survive SPA navigation; v0.27.1 network/annotator hardening; v0.27.0
  web-page text annotation; v0.26.0 user-centred hardening pass; v0.15.0 → v0.18.0 Phase 5; v0.13.0
  → v0.14.0 Phase 4; v0.8.0 → v0.12.0 Phase 3; v0.2.0 → v0.7.0 Phase 2; v0.0.1 → v0.1.1 Phase 1.
- **CI:** GitHub Actions — typecheck → lint → unit → build, plus an E2E job (Playwright under xvfb).
- **Tests:** 292 unit + 28 E2E (5 PDF viewer + 16 dashboard + 3 side panel + 4 web annotation),
  all green.

### v0.27.4 — quote cap + honest coarse CSS fallback (2026-07-27)

Two rough edges in `src/core/anchoring/web.ts` (A4 from the post-v0.27.0 hardening exploration).
**Quote cap:** `createWebAnchor` caps the stored text-quote `exact` at `MAX_QUOTE_EXACT = 10_000`
chars — a pathological whole-article selection omits the quote (keeping the compact, precise
text-position offsets) instead of bloating every stored/exported anchor; realistic highlights keep
their quote and its move-tolerant re-anchoring. **Honest coarse fallback:** `resolveWebAnchor` now
returns `{ range, approximate }` — the CSS fallback (which selects a whole element) is
`approximate: true`, and the annotator paints/counts a note as resolved only when
`range && !approximate`, so a coarse match is reported as "couldn't place on this page" via the
existing side-panel split rather than shown as a misleading block overlay. The CSS fallback's
`querySelector` is also guarded against a malformed selector from an untrusted snapshot (falls back
to no-match instead of aborting every note's repaint — mirrors the `webAnchorRoot` guard from
v0.27.3). Pure-and-tested in `web.ts`; one-line paint gate in the glue. Delivered TDD via
subagent-driven development (spec + plan in `doc/superpowers/`). 292 unit + 28 E2E. **Still open from
that exploration: A5** (`jumpTo` no-op for an unplaced note) and **A8** (host-permission denial
ignored by the content script).

### v0.27.3 — annotate inside open Shadow DOM (2026-07-27)

Selections made inside a web component's **open** shadow tree can now be annotated. `window.getSelection()`
doesn't descend into a shadow tree, so the annotator reads the selection from the `ShadowRoot` found in
the mouseup's composed path (captured synchronously) and anchors against that root; `WebAnchor` gained an
optional `shadowHost` (a light-DOM CSS path to the host) so the note re-anchors on reload. Backward
compatible and append-only — no IDB schema bump; existing anchors resolve against `document.body`
unchanged. `webAnchorRoot` guards a malformed `shadowHost` from an untrusted snapshot (falls back to
`document.body` rather than aborting every repaint). Built pure-and-tested in `web.ts`
(`createWebAnchor`/`resolveWebAnchor` root widened to `ParentNode`, new `webAnchorRoot`), with the
content-script glue in `annotator.ts`. **Explicitly not covered** (unreachable from a content script,
so no toolbar — as before, not a regression): cross-origin iframes, same-origin iframes (top-frame-only
injection), and closed shadow roots. A designed "can't annotate here" hint was dropped before release —
`composedPath()` omits closed roots entirely, so it could only misfire on benign open-shadow clicks.
Delivered TDD via subagent-driven development (spec + plan in `doc/superpowers/`). 286 unit + 28 E2E.

### v0.27.2 — web annotations survive SPA navigation (2026-07-26)

The freshly shipped annotator only re-loaded on injection or an explicit `annotator/changed`, so a
client-side navigation (SPA: document stays, URL + content change) left the previous page's
highlights lingering and never re-anchored the new URL. A content script can't observe the page's own
`pushState`/`replaceState` (main-world), so the annotator now watches `popstate`, the Navigation API
`navigatesuccess` where present, and a one-second poll as a catch-all; on any real URL change it
dismisses a stale toolbar and re-loads annotations for the new URL. Change detection is deduped in a
pure, unit-tested `src/content/url-watcher.ts` (`createUrlWatcher`); the re-anchor path is covered by
a new E2E case (pushState + popstate → overlay clears then re-paints on navigate-back). 281 unit + 27 E2E.

### v0.27.1 — network/annotator hardening (2026-07-26)

A hardening pass over the two network-facing paths and the just-shipped annotator, each fix behind a
unit test (the fetch/negotiation logic was extracted behind injected `fetch` seams). **Open-PDF-by-URL**
now runs through `src/core/files/fetch-pdf.ts` `fetchPdfBytes` — timeout, content-type + `%PDF-`
magic-byte validation, and a size cap — so a hung host, a 200-OK login page, or an oversized body can
no longer poison the file cache. **DOI import** validates the content type before `res.json()`, so a
DOI resolving to an HTML landing page gives a friendly error instead of a raw `SyntaxError`
(`negotiateCsl` extracted and tested). **Annotator activation** (`activate` / `registerOrigin` in
`annotator-control.ts`) wraps `executeScript` / `permissions.request` / `registerContentScripts` so a
`chrome://` page, denied prompt, or closed tab reports `{ ok:false }` instead of hanging the sender's
channel. **`commit()` / `loadExisting()`** in the content script catch a rejected round trip, dismiss
the toolbar, and paint nothing (new E2E case). Tests: 253→277 unit, 25→26 E2E.

### v0.27.0 — web-page text annotation (2026-07-26)

The last capability the 2026-07-25 audit had deferred: annotating live web pages, not just PDFs.
The pure anchoring core (`src/core/anchoring/web.ts`, the quote → position → CSS chain) was already
built and unit-tested; v0.27.0 wires it to a surface without weakening least-privilege. Selecting
text on any page raises a toolbar (**Highlight** / **Note**); the annotator renders overlays inside
a **shadow root** from the range's client rects — it never mutates page nodes — and the toolbar
lives in its own layer so it survives an overlay repaint, scroll and resize. There is **no static
content script and no `web_accessible_resources`**: the annotator is injected on demand
(`chrome.scripting.executeScript`) and the host permission is requested **per origin, opt-in** the
first time you annotate there. The side panel gains an **"On this page"** view listing the current
URL's notes and reporting which re-anchored after reflow, so an unplaceable note is flagged rather
than painted over unrelated text. New surface files: `src/content/annotator.ts` (+ `.css`),
`src/background/annotator-control.ts`, `src/core/usecases/web-annotation.ts`, built as a standalone
IIFE bundle (`vite.annotator.config.ts`) so Rollup never folds it into the service worker. Covered
by new unit tests (`web-annotation.test.ts`, `web.test.ts`) and an E2E (`e2e/webannotation.spec.ts`);
the production activation path (side-panel → `executeScript` → host-permission consent) is verified
manually, as Playwright cannot drive the permission prompt.

### v0.26.0 — user-centred hardening (2026-07-25)

An audit of the three surfaces (`doc/audit-2026-07-25.md`) for logical errors and usage-blocking
dead ends. Blockers and logic errors fixed: capture card re-scans on tab change (no more filing the
wrong page); the side-panel project switcher works and is remembered; bibliography export gates on
references not documents; PDF highlights flag themselves as "Moved?" when the quote no longer matches;
side-panel citations honour the configured style; references can be added / edited / deleted; sources
can be deleted with a cascade to their file bytes and annotations. The one item deferred here —
web-page text annotation — **shipped in v0.27.0** (see above).

### Phase 5 — scope decision (agreed with the user, 2026-07-24)

**Local-first, no backend.** The roadmap's third sync mode (self-hosted backend) is explicitly out of
scope: it would mean building a server with auth, an API and real-time sync, which is not this repo.
Consequences carried through the code and the UI:

- Roles are **advisory** and the Team view says so in plain words — every collaborator holds a full
  copy of the project in their own IndexedDB, so nothing can enforce a role.
- "Invite" creates a local pending member; nothing is sent. It travels in the next shared snapshot.
- The snapshot (M4) is a portable JSON file with **optional password encryption** (WebCrypto
  AES-GCM + PBKDF2): empty password → plain JSON for backup/inspection, password → encrypted file.

### Phase 5 milestones

| Milestone | Version | State |
|---|---|---|
| M1 — Members & roles: capability matrix (`src/core/model/roles.ts`), membership use-cases, Team view (6th nav item), `members/*` + `users/*` messages | v0.15.0 | ✅ |
| M2 — Activity feed: `ActivityEvent` entity, IDB **schema v3**, recording in the router cases, day-grouped feed with kind filters and before→after diffs | v0.16.0 | ✅ |
| M3 — Comment threads: `CommentThread` with embedded comments, IDB **schema v4**, start / reply / resolve / delete, Comments tab + "Discuss" on an annotation | v0.17.0 | ✅ |
| M4 — Snapshot export/import: portable JSON, optional AES-GCM password, merge on import with **hard DOI dedup**, sync-mode selector (local / file; backend shown as unavailable) | v0.18.0 | ✅ |

The Team view now has the design mock's full tab bar — **Activity | Comments | Members**. The
Comments counter shows **open** threads only: a resolved thread is not a to-do.

M4 decisions worth remembering: **PDF bytes are opt-in** — they dwarf everything else, and a snapshot
you cannot send is not a way of sharing work, so `includeFiles` is a checkbox rather than the default.
The file is an envelope with a `format` number, so an older build refuses a newer file instead of
mangling it; an **empty password gives plain JSON** (readable, diffable) and a password gives
AES-GCM + PBKDF2 (600k iterations, fresh salt and IV per export), with `projectName` / `exportedAt`
left in the clear so a file is identifiable without decrypting it. Merge: **hard DOI dedup** for
documents and references, with the folded id **remapped** so annotations and threads follow the copy
that was already here; everything else by id with the **newer `updatedAt` winning**; project members
**unioned**. Nothing is ever deleted by an import.

M3 decisions worth remembering: comments are **embedded in the thread record** rather than a second
store — the UI only ever reads a thread whole, so a reply is one atomic write. Threads are started
from a note (**Annotations → Discuss**), which anchors them to the annotation and inherits its
document and quote. Resolved threads take no further replies. Every thread change records a
`comment` event, the kind M2 defined and left unused, so the feed's chip appeared by itself.

M2 decisions worth remembering: events carry a seventh kind, **`source`**, beyond the mock's six —
filing a page is not the same act as importing a bibliographic record, and the feed says so. Events
are recorded in the **router cases**, so a change made in the side panel or the PDF reader is in the
feed without either surface knowing it exists, and `recordActivity` **never throws**: the feed records
a change, it does not gate one. Retention is a **read limit, not a purge** (200 per page, `Show
older`) — nothing is deleted, so the M4 snapshot can carry the whole history. `from` / `to` hold raw
domain values; labelling them is the view's job (`diffLabel` in `src/options/view-model.ts`).

### Phase 4 delivered (verified in headed Chromium + screenshots)

| Milestone | Version | State |
|---|---|---|
| M1 — Rule-driven CSL engine: `compileCsl` / `applyRulesToItem`, `formatWithStyle`, `citations/preview`, five vendored base CSL | v0.13.0 | ✅ |
| M2–M4 — Full-screen editor (profile rail, 5 rule groups, live citeproc preview, CSL-override tab, export/duplicate/delete) + `styleId` wired into every copy path | v0.14.0 | ✅ |

Two design decisions worth remembering: the **citation system is declared by the base CSL style**
(`<category citation-format="…"/>`), so the Author–date / Footnote / Numeric control switches the
base style rather than pretending to convert one — which is why **Chicago (notes & bibliography)** is
now vendored. And rules land through three levers: CSL attribute injection (names, page label),
CSL-JSON reshaping (identifiers, FOI / legal templates) and one rendered-text rewrite (`doi:` form).

### Phase 3 delivered (verified end-to-end in headed Chromium + screenshots)

| Milestone | Version | State |
|---|---|---|
| M1 — File store (IDB schema v2) + pure PDF anchoring core (fraction rects) | v0.8.0 | ✅ |
| M2 — pdf.js reader surface (`src/pdfviewer/`): canvas render, zoom, page nav | v0.9.0 | ✅ |
| M3 — Text anchoring (text-layer select → highlight) + annotations rail | v0.10.0 | ✅ |
| M4 — Region anchoring (drag a rectangle) | v0.11.0 | ✅ |
| M5 — Ingestion UX (dashboard "Add PDF" upload + "Open in reader" / URL fetch) | v0.12.0 | ✅ |

`pdfjs-dist` bundled locally with its ESM worker (default MV3 CSP intact; worker/viewer web-accessible;
viewer is a Rollup input). Anchors stored as fraction rects → invariant to zoom/DPR. File bytes cross
the messaging channel as base64. IndexedDB bumped to v2 (`files` store); `migrations[1]` untouched.

### Phase 2 recap (shipped, on `main`)

Dashboard shell · Overview + Kanban · Documents · References + DOI import · Annotations · Citation
styles (v0.2.0–v0.7.0). Dashboard-local CSS; side panel untouched.

### Deferred by design (not blocking)

- `CitationStyle.cslOverride` is still not persisted — the override object is generated on demand for
  the editor's code view; storing it would only duplicate `userRules`.
- Per-annotation "section" + link-to-section (mock nicety) omitted — the domain `Annotation` has no
  section field.
- **DOI import** and **open-PDF-by-URL** real-network round trips need a runtime host-permission grant
  and are not exercised in headless CI. Their fetch/negotiation logic **is** unit-tested with an
  injected `fetch` (`src/core/usecases/references.test.ts`, `src/core/files/fetch-pdf.test.ts` — the
  latter added in v0.27.1 with content-type/size/timeout hardening); the live network hop is not.
- Prior Phase 1 follow-ups still stand (dev-dep dependabot alerts, OFL web fonts).

### Delivered (verified end-to-end in real Chrome)

| Area | State |
|---|---|
| MV3 scaffold, least-privilege perms (`sidePanel` + optional hosts) | ✅ |
| IndexedDB storage (idb, versioned schema, migrations, DOI dedup) | ✅ |
| Typed UI↔SW messaging + pure router | ✅ |
| Capture: metadata extraction, W3C web anchoring, DOI dedup | ✅ |
| CSL citations via citeproc-js — APA/Harvard/Vancouver/Chicago/MLA (13 golden tests) | ✅ |
| Side Panel UI (capture card, status pipeline reading list, citation copy) | ✅ |
| E2E (extension loaded in headed Chromium) | ✅ |

### Architecture

Ports & adapters: pure domain core in `src/core` (no `chrome.*`), thin adapters in `src/adapters`.
Surfaces: `src/background` (service worker), `src/sidepanel`, `src/options` (dashboard) and
`src/pdfviewer` (bundled pdf.js reader).

## From the code audit (2026-07-24)

**All findings are closed.** The audit's one serious result — HTML injection through an imported
snapshot — was fixed in **v0.22.0** (import boundary + escaping at every sink); the missing extension
icons in **v0.23.0**; and the remaining six in **v0.24.0**: `web_accessible_resources` removed as
unnecessary, a timeout on the DOI lookup, the anchor fallback chain no longer abandoned by a throwing
first strategy, activity `entityId` remapped only for the kinds that point at a document, honest
provenance for DOI imports, `blocked`/`blocking` handlers on the database, and keyboard navigation in
the side-panel status menu.

Verified clean during the audit, so nobody re-audits them: the URL-when-no-DOI rule (the base CSL
implements the fallback — checked against real citeproc output), the PDF anchoring maths, the
snapshot cryptography, the last-owner invariant, and `recordActivity` never throwing.

## Known follow-ups (not blocking)

1. ~~**OFL web fonts**~~ — **done in v0.25.0**, as a decision taken rather than a chore slipped in:
   Charis SIL (derived from Charter) and IBM Plex Mono (the ancestor of iA Writer Mono) sit after
   the licensed names in each stack, with `latin` and `latin-ext` subsets so Polish renders. 236 kB
   packaged, 146 kB loaded, read from disk. Licences travel with them in `THIRD-PARTY-NOTICES.md`.
2. **DOI import and open-PDF-by-URL** still need a runtime host-permission grant and are not
   exercised in headless CI. The fetch/negotiation logic is unit-tested with an injected `fetch`
   (`references.test.ts`, `fetch-pdf.test.ts`); only the live network hop is uncovered.

## Resume plan — next steps

**The roadmap is done. What follows is polish, not phases.** `main` is green at v0.18.0 and the
working tree is clean. The strongest candidates, roughly in order of value:

1. ~~**Bundle size**~~ — **done in v0.18.1**: base CSL styles are fetched as extension assets on
   first use instead of being inlined, cutting the service worker from 1.15 MB to 631 kB (45%).
   `CitationFormatter` went async and `CiteJsFormatter` takes a `CslLoader`; a miss is remembered so
   a broken asset is not retried on every citation.
2. ~~**Import a third-party `.csl`**~~ — **done in v0.19.0**: validated on import (a dependent style
   is refused, since citeproc cannot format with one), stored in **schema v5** `customBaseStyles`,
   and selectable in the editor's picker. Imported styles are registered under a name carrying a
   hash of their XML, because citation-js caches citeproc engines by template name with no way to
   evict one — without that, a re-imported file kept formatting with the old engine.
3. ~~**Snapshot ergonomics**~~ — **done in v0.20.0**: choosing a file plans the merge and shows the
   numbers before anything is written (`planMerge` / `previewMerge`, message `snapshot/preview`).
   Remembering the export folder is **dropped**: Chrome owns the download location, and the
   `downloads` permission would buy a preference MV3 does not honour.
4. **Presence** (the one Phase 5 goal not delivered) needs a live channel between clients, which a
   file-based mode cannot provide. It arrives only with a backend, and a backend is out of scope.
5. ~~**Standing follow-ups**~~ — **done in v0.21.0**: dev dependencies audited (6 vulnerabilities →
   0; they were vitest's vite/esbuild chain, not `@crxjs` as previously recorded) and `@crxjs`
   moved off beta to 2.7.1; the side panel gained a status menu, so a source can move *back*.
   **OFL fonts are deliberately not bundled** — see the note below.

**Smaller follow-ons in the citation area:** bundle size (the Chicago notes CSL is 243 kB raw —
lazy-loading base styles from `web_accessible_resources` would trim the SW), and importing a
third-party `.csl` file as a base style.

### How to resume

```
/loop work through the polish list above, one item per iteration, full loop each time
```

Environment is ready: Node 22, deps installed, `gh` authenticated with `workflow` scope, Playwright
Chromium installed, xvfb available. Run `npm run dev` to load the extension, `npm test` for units,
`npm run test:e2e` for E2E.
