# Project Overview

Scientific Context Notes is a Chrome (Manifest V3) research companion: it files web pages and PDFs
into projects, anchors notes to the exact passage they came from, and produces citations and
bibliographies through real CSL. Everything lives in this browser's IndexedDB — there is no backend,
and there is not going to be one, so collaboration travels as a portable snapshot file rather than
through a server. All five roadmap phases are delivered; work now is polish, hardening and
distribution.

# Tech Stack

Exact versions as installed (`package-lock.json`); update this section when they move.

| Layer           | What                                                                                    | Version                         |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| Runtime target  | Chrome / Chromium, MV3                                                                  | `minimum_chrome_version: 116`   |
| Language        | TypeScript — `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ES2022 | 5.9.3                           |
| Build           | Vite                                                                                    | 6.4.3                           |
| Extension build | `@crxjs/vite-plugin`                                                                    | 2.7.1                           |
| Storage         | `idb` over IndexedDB — schema **v5**                                                    | 8.0.3                           |
| Citations       | `@citation-js/core` + `@citation-js/plugin-csl` (citeproc-js)                           | 0.7.21 / 0.7.22                 |
| PDF             | `pdfjs-dist`, bundled with its ESM worker                                               | 4.10.38                         |
| Web anchoring   | `dom-anchor-text-quote` / `dom-anchor-text-position`                                    | 4.0.2 / 5.0.0                   |
| Unit tests      | Vitest + `fake-indexeddb` + jsdom                                                       | 3.2.7 / 6.2.5 / 25.0.1          |
| E2E             | Playwright (headed Chromium under xvfb)                                                 | 1.61.1                          |
| Lint / format   | ESLint + typescript-eslint, Prettier                                                    | 9.39.5 / 8.65.0 / 3.9.6         |
| Dev environment | Node                                                                                    | 22 (CI pins `node-version: 22`) |

No runtime dependency may be loaded from a CDN — MV3 forbids remote code, and every vendored asset
(CSL styles, pdf.js worker, citeproc) ships inside the extension.

## Commands

```bash
npm run dev        # Vite + MV3 HMR; load dist/ as an unpacked extension
npm run build      # typecheck + production build → dist/
npm test           # unit tests
npm run test:e2e   # builds, then Playwright under xvfb
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

CI runs typecheck → lint → unit → build, plus a separate E2E job. Both must be green on `main`.

# Naming & Coding Conventions

## Architecture — ports and adapters

- `src/core` is the domain: **no `chrome.*`, no IndexedDB types, no DOM** (except `src/core/anchoring/web.ts`,
  which is DOM-dependent by nature and tested under jsdom). Storage is reached through the ports in
  `src/core/ports/`.
- `src/adapters` holds the thin implementations: `idb/`, `chrome/`, `citation/`.
- Surfaces: `src/background` (service worker), `src/sidepanel`, `src/options` (dashboard),
  `src/pdfviewer` (bundled reader).
- Surfaces never touch storage. They send typed messages (`src/core/messages.ts`) to the service
  worker, which routes them through the pure `handleRequest`.

## Rules that exist because breaking them caused a bug

- **Record domain changes in the router**, not in a UI. That is why a status moved in the side panel
  shows up in the activity feed without the side panel knowing the feed exists.
- **Migrations are append-only.** Add `migrations[n]`; never edit a shipped one. Bump `DB_VERSION`
  in the same commit.
- **An imported snapshot is somebody else's data.** It passes through
  `src/core/snapshot/validate.ts` before anything is planned or written. Ids are validated against a
  pattern, enums are checked, dates are normalised to UTC. (v0.22.0 fixed an HTML injection here.)
- **Escape at the sink.** Anything interpolated into `innerHTML` goes through `esc()`; ids used in a
  `querySelector` go through `CSS.escape()`. `toast()` escapes its own message — callers must not
  pre-escape, or text renders as `&amp;`.
- **Build DOM programmatically where practical** (`dataset`, `textContent`), as the side panel does.
  It is immune to the injection class above by construction.
- **A `position: fixed` popover repositions on scroll, it does not close.** A late layout shift fires
  a scroll event that would otherwise remove it mid-click.
- **Never assert on short strings inside random data.** An encrypted blob contains `d1` about one run
  in three; two tests were flaky on exactly that.

## Style

- Vanilla TypeScript on every surface — no UI framework. A single `state` object plus a full-redraw
  `render()`; the dashboard and side panel both follow it.
- Files are `kebab-case.ts`; types and interfaces `PascalCase`; functions and variables `camelCase`;
  message types are `domain/verb` (`documents/put`, `snapshot/preview`).
- Unit tests live next to pure modules (`x.test.ts`) or in `test/` when they need repositories; E2E
  lives in `e2e/`.
- Comments explain **why**, not what. If a line looks odd and is deliberate, say what would break
  otherwise. Formatting is fixed by `.prettierrc.json`, `.editorconfig` and `eslint.config.js` — read those rather than inferring style from a file you happen to open.

## Releases

One minor version per milestone, patch for fixes; SemVer. Bump `package.json`, move the entries into
a new `CHANGELOG.md` section, update `README.md` and `doc/STATUS.md`, commit as
`chore(release): vX.Y.Z — summary` (or a `feat:` / `fix:` commit when the release is one change),
tag, push with `--follow-tags`, then `gh release create`. **Documentation ships with the release** —
README, the affected `doc/` files and the GitHub repo description, not afterwards.

# Protected Files

Do not modify these without an explicit instruction:

- `src/adapters/idb/schema.ts` → **`migrations[1]`–`migrations[5]`**. Shipped migrations are running
  in real profiles; editing one corrupts every database that already applied it. Append instead.
- `src/assets/csl/*.csl` — vendored upstream CSL styles. They are data, not our code; replace a whole
  file from upstream rather than hand-editing, or the golden citation tests become meaningless.
- `doc/design_mock/**` — the design contract the UI was ported from. Read-only reference.
- `e2e/fixtures/sample.pdf` — byte-for-byte fixture; several PDF tests assert against its rendering.
- `dist/` — build output, never edited by hand and never committed.
- `package-lock.json` — changed only by npm, never by hand.
- Released `CHANGELOG.md` sections — history is append-only; correct a mistake in a new entry.
