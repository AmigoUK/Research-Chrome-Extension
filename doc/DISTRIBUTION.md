# Distribution — Chrome Web Store

How to package and publish Scientific Context Notes. The extension currently also loads unpacked from
`dist/` (see the README); this doc covers the packaged Web Store path.

## 1. Build and package

```bash
npm run package
```

This runs a production build and writes an uploadable zip to
`release/context-notes-v<version>.zip`. The zip's root is the extension (manifest at the top level),
source maps are excluded, and the version comes from `package.json` — so it always matches the
release you tagged. `release/` is git-ignored.

The zip is the artifact you upload; do **not** upload the source repo.

## 2. Upload

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Select the item (or **Add new item** for the first submission) and upload
   `release/context-notes-v<version>.zip`.
3. Every store update needs a **higher version** than the published one. Our release flow already
   bumps `package.json` (see the "Releases" section in `CLAUDE.md`), and the manifest version is
   derived from it, so a normal release produces an upload-ready bump automatically.

## 3. Store listing checklist

- **Name:** Scientific Context Notes
- **Summary (≤132 chars):** A local-first research companion — file pages and PDFs into projects,
  anchor notes to the exact passage, and produce real CSL citations.
- **Category:** Productivity (or Education).
- **Detailed description:** adapt the README's "What it does" table into prose; lead with the
  local-first, no-backend promise.
- **Screenshots:** use `doc/screenshots/` (1280×800). Good hero shots: `01-overview.png`,
  `14-pdf-reader.png`, `12-side-panel.png`.
- **Icon:** shipped in the build (declared in the manifest).
- **Single-purpose description:** "Organise research sources and anchor notes/citations to the exact
  passage they came from, entirely within the browser."
- **Privacy policy URL:** host `doc/PRIVACY.md` (e.g. GitHub Pages or the repo's rendered file) and
  link it here — **required**, because the extension requests broad optional host permissions.

## 4. Permissions justification (the review asks for each)

| Permission | Why it's needed |
|---|---|
| `storage` | Store projects, documents, annotations and citations locally in IndexedDB. |
| `activeTab` + `scripting` | Inject the annotator into the page you're viewing, on demand, when you choose to annotate it. |
| `sidePanel` | The extension's primary workspace surface. |
| `optional_host_permissions: *://*/*` | Requested **per site, opt-in**, only to read the page text you annotate so highlights can be anchored. Never granted up front; page content is read locally and never transmitted. |

## 5. Review notes worth stating

- **Manifest V3, no remote code** — every asset (CSL styles, the pdf.js reader and worker, the
  citeproc engine, fonts) is bundled; nothing is loaded from a CDN.
- **Local-first, no backend** — no servers, telemetry, or accounts. See `doc/PRIVACY.md`.
- **Host access is optional and per-origin** — the extension holds no standing access to your
  browsing; it asks the first time you annotate a given site.

## 6. Attach the zip to the GitHub release

Our release step uploads the same zip as a release asset, so a tag and its store upload are the same
bytes:

```bash
npm run package
gh release upload v<version> release/context-notes-v<version>.zip
```

(For a brand-new release, `gh release create v<version> … release/context-notes-v<version>.zip`
creates it and attaches the asset in one call.)
