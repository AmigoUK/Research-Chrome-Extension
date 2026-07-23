# Project Status & Resume Plan

_Last updated: 2026-07-23 — Phase 3 complete._

## Where we are

**Phase 3 (PDF Anchoring) is complete and shipped.** The autonomous loop worked through all five
milestones (M1–M5), each with the full loop (plan → code → test → commit → release). Phase 2
(Dashboard) shipped and merged to `main` at v0.7.0; Phase 1 MVP earlier at v0.1.1.

- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Branch state:** work on **`feat/phase-3-pdf`** at **v0.12.0** (not yet merged to `main`, which is
  at v0.7.0).
- **Releases:** v0.8.0 → v0.12.0 (5 Phase-3 GitHub releases; v0.2.0 → v0.7.0 Phase 2; v0.0.1 → v0.1.1 Phase 1).
- **CI:** GitHub Actions — typecheck → lint → unit → build, plus an E2E job (Playwright under xvfb).
- **Tests:** 83 unit + 14 E2E (5 PDF viewer + 7 dashboard + 2 side panel), all green.

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

- **Team view** and the **full CSL rule editor** (Phase 4) remain deferred.
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

Ports & adapters: pure domain core in `src/core` (no `chrome.*`), thin adapters in
`src/adapters`. Surfaces in `src/background` (service worker), `src/sidepanel`, `src/options`
(stub).

## Known follow-ups (not blocking)

1. **Dev-dep audit** — 5 dependabot alerts, all in dev tooling (`@crxjs` beta transitive deps).
   `npm audit --omit=dev` = **0 production vulnerabilities**. `audit fix --force` deferred to avoid
   breaking the build; revisit when @crxjs leaves beta.
2. **OFL web fonts** — the side panel uses a graceful system-font stack; bundling licensed OFL
   serif + mono for cross-platform visual fidelity is a small polish task.
3. **Per-source status control** — the reading list advances status by click-cycling; the
   prototype's "move to" popover is a nicety for later.

## Resume plan — next steps

**Immediate housekeeping:** decide whether to merge `feat/phase-3-pdf` → `main` (Phases 1–2 kept
`main` current). Not done automatically — `main` is still at v0.7.0.

**Phase 4 — CSL style editor** (design ready: `doc/design_mock/.../citation-style-editor.html`, the
"Full editor" the dashboard's Citation-styles view already links to). Extends the lightweight rule
editor into the full CSL override editor: grouped rule sections (system, authors, identifiers,
formatting, special sources), an editable style name, and a dark syntax-highlighted CSL/JSON preview.
`CitationStyle.cslOverride` + `CitationUserRules` already exist in the model.

**Also outstanding:** the deferred **Team** view (Phase 2, `collaboration-sync.html`) and Phase 5
collaboration/sync — pick either as a follow-on.

### How to resume

```
/loop work through Phase 4 (CSL style editor) milestones, one milestone per iteration, full loop each time
```

Environment is ready: Node 22, deps installed, `gh` authenticated with `workflow` scope, Playwright
Chromium installed, xvfb available. Run `npm run dev` to load the extension, `npm test` for units,
`npm run test:e2e` for E2E.
