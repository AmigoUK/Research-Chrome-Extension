# Project Status & Resume Plan

_Last updated: 2026-07-23 — Phase 2 core complete._

## Where we are

**Phase 2 (Dashboard & Workflow) core is complete and shipped.** The autonomous loop worked
through all six milestones (M1–M6), each with the full loop (plan → code → test → commit → release).
Phase 1 MVP shipped earlier at v0.1.1.

- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Branch state:** work on **`feat/phase-2-dashboard`** at **v0.7.0** (not yet merged to `main`,
  which is at v0.1.1).
- **Releases:** v0.2.0 → v0.7.0 (6 Phase-2 GitHub releases; earlier v0.0.1 → v0.1.1 for Phase 1).
- **CI:** GitHub Actions — typecheck → lint → unit → build, plus an E2E job (Playwright under xvfb).
- **Tests:** 71 unit + 9 E2E (7 dashboard + 2 side panel), all green.

### Phase 2 delivered (verified end-to-end in headed Chromium + screenshots)

| Milestone | Version | State |
|---|---|---|
| M1 — Dashboard app-shell (sidebar, project switcher, router, drawer, credit footer) | v0.2.0 | ✅ |
| M2 — Overview stat tiles + Kanban (drag-and-drop + keyboard), status popover | v0.3.0 | ✅ |
| M3 — Documents table (search, status filter chips, status pill, DOI link) | v0.4.0 | ✅ |
| M4 — References view + DOI import (doi.org content negotiation, dedupe) | v0.5.0 | ✅ |
| M5 — Annotations view (anchor locator, review-status workflow, Cite) | v0.6.0 | ✅ |
| M6 — Citation styles (profiles + lightweight rule editor, live preview) | v0.7.0 | ✅ |

Dashboard-local CSS (`src/options/dashboard.css`); the side panel's `panel.css` was left untouched.
New read/write messages wired with no IndexedDB schema change (all stores existed in schema v1).

### Deferred by design (not blocking)

- **Team view** (members/roles) and the **full CSL rule editor** (Phase 4) were scoped out of the
  core-first Phase 2.
- **DOI import** is verified via unit tests (injected fetch) and the import-form E2E; a real-network
  round trip needs the runtime host-permission grant and was not exercised in headless CI.
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

**Immediate housekeeping:** decide whether to merge `feat/phase-2-dashboard` → `main` (Phase 1 kept
the two in sync). Not done automatically — `main` is still at v0.1.1.

**Remaining Phase 2 (optional, deferred):** the **Team** view (members/roles, links to
`collaboration-sync.html`) and richer capture-into-project from the dashboard.

**Phase 3 — PDF anchoring** (design ready: `doc/design_mock/.../pdf-anchoring.html`). A heavy epic:
bundle a pdf.js viewer, render pages, and resolve `PdfAnchor` (page + percent-coordinate rects) for
text highlights and figure/table region selections. The `PdfAnchor` type and store already exist.

Later phases (designs also ready): Phase 4 CSL style editor (`citation-style-editor.html`, the "Full
editor" the dashboard links to), Phase 5 collaboration/sync (`collaboration-sync.html`).

### How to resume

```
/loop work through Phase 3 (PDF anchoring) milestones, one milestone per iteration, full loop each time
```

Environment is ready: Node 22, deps installed, `gh` authenticated with `workflow` scope, Playwright
Chromium installed, xvfb available. Run `npm run dev` to load the extension, `npm test` for units,
`npm run test:e2e` for E2E.
