# Build Plan — Phase 1 MVP

Execution plan for the first milestone of **Scientific Context Notes** (Chrome MV3 research
companion). Prepared by the AI Agents Council from the specification in this `doc/` folder and the
design prototypes in `doc/design_mock/`.

## Decisions locked

- **Language / UI:** TypeScript + Vanilla (port the prototype DOM 1:1; no UI framework — smallest bundle, closest to the existing design).
- **Repository:** https://github.com/AmigoUK/Research-Chrome-Extension
- **First milestone:** Phase 1 MVP — a working extension for solo research (capture → file → annotate → cite).

## Ground rules (per engagement)

- **Full loop every task:** plan → code → run tests → fix → commit. No code lands without tests.
- **Release management from day one:** SemVer starting `v0.0.1`, `CHANGELOG.md` (Keep a Changelog), git tags, GitHub releases. Bump before committing the change.
- **Three-attempts rule:** if the same failure survives three fixes, stop and convene a cross-council debugging session.
- **Domain core stays pure** (no `chrome.*`) so it is unit-testable; `chrome.*` lives behind thin adapters.
- **MV3 invariants:** IndexedDB only (no SQLite); no remote code (citeproc-js + fonts bundled); least-privilege host permissions.
- Use `context7` MCP for up-to-date library docs (idb, citeproc-js, pdf.js, Vite/@crxjs, Playwright) instead of relying on memory.

---

## M0 — Foundation & tooling
**Goal:** a building, linting, testing, loadable empty extension in the repo.

1. Confirm working dir (`pwd` → `/var/www/html/ResearchContextNotes`); connect the repo `https://github.com/AmigoUK/Research-Chrome-Extension` (`git init` + `git remote add origin …`, or clone into place), and reconcile with the existing `doc/` contents.
2. `CLAUDE.md` at repo root via `/init`, reviewed, with the four required sections (Overview / Tech Stack with versions / Naming & Conventions / Protected Files).
3. Toolchain: package manager, **TypeScript (strict)**, bundler (**Vite + `@crxjs/vite-plugin`** for MV3 HMR), **Vitest** (unit), **Playwright** (E2E), ESLint + Prettier, `.editorconfig`.
4. `manifest.json` (MV3): `permissions: [storage, scripting, activeTab, sidePanel]`, `optional_host_permissions`, service worker entry, side panel entry, options page.
5. Release scaffolding: `package.json` `"version": "0.0.1"`, `CHANGELOG.md` `[0.0.1]` initial scaffold.
6. CI (GitHub Actions): typecheck → lint → unit → build on push/PR.

**Acceptance:** `npm run build` produces a loadable unpacked extension; `npm test` and CI green.
**Release:** commit `chore(release): v0.0.1 — initial scaffold`, tag, GitHub release.

## M1 — Domain core (pure, TDD)
**Goal:** typed model + storage layer, fully unit-tested, zero `chrome.*`.

1. Types for `Project`, `Document`, `Annotation` (multi-strategy `anchor`), `Reference`, `CitationStyle`, `User` — mirroring `data-model.md`.
2. IndexedDB layer via **`idb`**: versioned schema, `onupgradeneeded` migrations, object stores + indexes (incl. index for DOI dedup).
3. Repository ports (interfaces) + IndexedDB adapter implementing them.
4. Vitest unit tests first (TDD) for CRUD, migrations, and DOI-dedup.

**Acceptance:** repositories pass unit tests incl. a v1→v2 migration test.

## M2 — Service worker & messaging
**Goal:** cold-start-safe background with a typed message router.

1. Service worker: event handlers assume cold start; no in-memory critical state.
2. Typed message contract UI ↔ SW; router dispatches to domain-core use-cases.
3. `chrome.*` adapters (storage/messaging/sidePanel/scripting) behind interfaces, mocked in tests.

**Acceptance:** round-trip message test (mocked runtime) creates and reads a `Document`.

## M3 — Metadata extraction & web anchoring
**Goal:** capture the open page into a project with a real reference.

1. Content script: extract title, canonical URL, DOI (and minimal metadata) → build `Document` + `Reference` (`source: extractedFromPage`).
2. Web text anchoring: W3C **text-quote → text-position → CSS selector** fallback (reuse `dom-anchor-text-quote` / position libraries — do not hand-roll).
3. Persist annotations via the SW.

**Acceptance:** capturing a real article page creates deduped `Document`/`Reference`; a text annotation re-anchors after reload.

## M4 — CSL citations
**Goal:** correct in-text and bibliography output from stored references.

1. Bundle **citeproc-js** + locale files + base styles (APA, Chicago, Harvard, MLA) as assets.
2. Format in-text + bibliography in the SW from `Reference.cslData` + selected `CitationStyle`.
3. Phase-1 subset of the rule→override contract (max authors, et al., DOI/URL inclusion) per `citations.md`.

**Acceptance:** golden-file tests for the 4 base styles across 1/3/4-author references.

## M5 — Side Panel UI (port from prototype)
**Goal:** the `research-companion-panel.html` experience, wired to real data.

1. Extract the shared design tokens into one stylesheet; **bundle the web fonts locally**.
2. Port the panel to TS + vanilla DOM, preserving layout, states, `data-od-id`, and a11y (roles, keyboard, `prefers-reduced-motion`).
3. Wire capture card, reading list (status pipeline groups/filters/search), and citation copy to SW/IndexedDB.

**Acceptance:** filing the open page, moving it through statuses, and copying in-text/bibliography all persist and survive reload.

## M6 — E2E, footer decision & release
**Goal:** ship a tagged MVP.

1. Playwright happy-path (load extension → capture → annotate → file → copy citation).
2. Decide credit-footer inclusion for extension surfaces (ask once, persist to project memory).
3. `CHANGELOG` → `[0.1.0]`, bump version, tag `v0.1.0`, GitHub release.

**Acceptance:** E2E green in CI; `v0.1.0` released.

---

## Verification (end to end)
- `npm run build` → load unpacked in Chrome → capture a real paper → file into a project → add a text note → move status → copy in-text & bibliography → reload and confirm persistence + re-anchoring.
- CI: typecheck + lint + unit + E2E all green on the release commit.

## Out of scope (later phases)
- Phase 2 dashboard, Phase 3 PDF (pdf.js viewer), Phase 4 style editor, Phase 5 collaboration/sync — each its own milestone set, designs already in `doc/design_mock/`.
