# Changelog

All notable changes to **Scientific Context Notes** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Phase 1 MVP in progress — see `doc/build-plan.md`._

## [0.0.1] — 2026-07-23

### Added

- Initial project scaffold: MV3 manifest via `@crxjs/vite-plugin`, TypeScript (strict), Vite build.
- Background service worker, side panel, and options-page stubs.
- Domain-core seed (`workflow` statuses) with Vitest unit tests.
- Tooling: ESLint (flat config), Prettier, EditorConfig, Vitest + v8 coverage.
- GitHub Actions CI: typecheck → lint → unit → build.

[Unreleased]: https://github.com/AmigoUK/Research-Chrome-Extension/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/AmigoUK/Research-Chrome-Extension/releases/tag/v0.0.1
