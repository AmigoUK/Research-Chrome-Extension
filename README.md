# Scientific Context Notes

A Chrome (Manifest V3) research companion: contextual annotations on web pages and PDFs,
project-based organisation of sources, and automatic citations/bibliographies via CSL.

> Status: **Phase 1 MVP in progress.** See [`doc/`](doc/) for the specification and
> [`doc/build-plan.md`](doc/build-plan.md) for the milestone plan.

## Development

```bash
npm install       # install dependencies
npm run dev       # Vite dev server with MV3 HMR (load dist/ as an unpacked extension)
npm run build     # typecheck + production build → dist/
npm test          # unit tests (Vitest)
npm run lint      # ESLint
```

Load the unpacked extension from `dist/` at `chrome://extensions` (Developer mode).

## Architecture

- **Storage:** IndexedDB (versioned schema, no SQLite) accessed from an ephemeral MV3 service worker.
- **UI surfaces:** side panel (primary), popup, options/dashboard.
- **Citations:** citeproc-js + CSL, bundled locally (no remote code).
- **Testability:** a pure domain core (`src/core`) with `chrome.*` behind adapters.

See [`doc/architecture.md`](doc/architecture.md).
