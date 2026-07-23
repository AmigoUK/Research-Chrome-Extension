# Changelog

All notable changes to **Scientific Context Notes** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Phase 1 MVP in progress — see `doc/build-plan.md`._

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

[Unreleased]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/AmigoUK/Research-Chrome-Extension/releases/tag/v0.0.1
