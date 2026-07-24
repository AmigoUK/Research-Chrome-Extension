# Project Status & Resume Plan

_Last updated: 2026-07-24 — **all five roadmap phases delivered**; now on the polish list (1 of 5 done)._

## Where we are

**Every roadmap phase is delivered and on `main`.** Phase 5 (Collaboration & Sync) closed at
**v0.18.0** with snapshot export/import; the roadmap's third sync mode (a self-hosted backend) stays
out of scope by an explicit decision, and the UI shows it as unavailable rather than pretending.

- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Branch state:** everything through **v0.18.1 is on `main`** (Phases 1–5 + polish). No unmerged work.
- **Releases:** v0.15.0 → v0.18.0 Phase 5; v0.13.0 → v0.14.0 Phase 4; v0.8.0 → v0.12.0
  Phase 3; v0.2.0 → v0.7.0 Phase 2; v0.0.1 → v0.1.1 Phase 1.
- **CI:** GitHub Actions — typecheck → lint → unit → build, plus an E2E job (Playwright under xvfb).
- **Tests:** 206 unit + 19 E2E (5 PDF viewer + 12 dashboard + 2 side panel), all green.

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
  and were not exercised in headless CI (both unit-tested / covered by seeded-path E2E).
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

## Known follow-ups (not blocking)

1. **Dev-dep audit** — 5 dependabot alerts, all in dev tooling (`@crxjs` beta transitive deps).
   `npm audit --omit=dev` = **0 production vulnerabilities**. `audit fix --force` deferred to avoid
   breaking the build; revisit when @crxjs leaves beta.
2. **OFL web fonts** — the side panel uses a graceful system-font stack; bundling licensed OFL
   serif + mono for cross-platform visual fidelity is a small polish task.
3. **Per-source status control** — the reading list advances status by click-cycling; the
   prototype's "move to" popover is a nicety for later.

## Resume plan — next steps

**The roadmap is done. What follows is polish, not phases.** `main` is green at v0.18.0 and the
working tree is clean. The strongest candidates, roughly in order of value:

1. ~~**Bundle size**~~ — **done in v0.18.1**: base CSL styles are fetched as extension assets on
   first use instead of being inlined, cutting the service worker from 1.15 MB to 631 kB (45%).
   `CitationFormatter` went async and `CiteJsFormatter` takes a `CslLoader`; a miss is remembered so
   a broken asset is not retried on every citation.
2. **Import a third-party `.csl`** as a base style — the editor can already export one.
3. **Snapshot ergonomics** — a dry-run import that reports what *would* merge before it writes, and
   remembering the last export folder. Both are small; neither is needed for correctness.
4. **Presence** (the one Phase 5 goal not delivered) needs a live channel between clients, which a
   file-based mode cannot provide. It arrives only with a backend, and a backend is out of scope.
5. The standing follow-ups below: dev-dep audit, OFL fonts, per-source status popover.

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
