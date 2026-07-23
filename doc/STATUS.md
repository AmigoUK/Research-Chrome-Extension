# Project Status & Resume Plan

_Last updated: 2026-07-23 — end of session._

## Where we are

**Phase 1 MVP is complete and shipped.** The autonomous loop worked through all seven
milestones (M0–M6) of [`build-plan.md`](build-plan.md), each with the full loop
(plan → code → test → commit → release).

- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Branch state:** `main` and `feat/phase-1-mvp` both at **v0.1.1** (in sync).
- **Releases:** v0.0.1 → v0.1.1 (7 GitHub releases, tags on `main`).
- **CI:** GitHub Actions — typecheck → lint → unit → build, plus an E2E job (Playwright under xvfb).
- **Tests:** 56 unit + 2 E2E, all green.

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

## Resume plan — Phase 2 (Dashboard & Workflow)

Designs already exist in `doc/design_mock/` (`research-dashboard.html`). Suggested milestones:

1. **Dashboard shell** — options page app-shell (sidebar nav, project switcher, router) with the
   **credit footer** (decision: footer goes here, NOT the side panel — see project memory).
2. **Documents & references views** — tables with search/status filter, import (Zotero/BibTeX/RIS/DOI).
3. **Annotations view** — list across the project with the `draft/accepted/rejected/includedInReport`
   review workflow.
4. **Kanban board** — drag-and-drop + arrow-key status moves across the four stages.
5. **Citation styles view** — style profiles + the rule editor (bridges to Phase 4 style editor).

Later phases (designs also ready): Phase 3 PDF anchoring (`pdf-anchoring.html`, own pdf.js viewer —
heavy epic), Phase 4 CSL style editor (`citation-style-editor.html`), Phase 5 collaboration/sync
(`collaboration-sync.html`, evolutionary path local → file-based → backend).

### How to resume

```
/loop work through Phase 2 (Dashboard) milestones, one milestone per iteration, full loop each time
```

Environment is ready: Node 22, deps installed, `gh` authenticated with `workflow` scope, Playwright
Chromium installed, xvfb available. Run `npm run dev` to load the extension, `npm test` for units,
`npm run test:e2e` for E2E.
