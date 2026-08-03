# Distribution — Chrome Web Store

How to package and publish Scientific Context Notes. The extension currently also loads unpacked from
`dist/` (see the README); this doc covers the packaged Web Store path.

## 1. Build and package

```bash
npm run package
```

This runs a production build, writes an uploadable zip to `release/context-notes-v<version>.zip`,
and then **checks it against what the store enforces at upload** (`scripts/validate-package.mjs`) —
manifest shape, the 132-character summary limit, all four icons and every referenced surface being
present, and no source maps or build junk in the archive. A failure here is one the dashboard would
otherwise report after a login and an upload.

The zip's root is the extension (manifest at the top level), source maps are excluded, and the
version comes from `package.json` — so it always matches the release you tagged. `release/` is
git-ignored.

The zip is the artifact you upload; do **not** upload the source repo.

## 2. Upload

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Select the item (or **Add new item** for the first submission) and upload
   `release/context-notes-v<version>.zip`.
3. Every store update needs a **higher version** than the published one. Our release flow already
   bumps `package.json` (see the "Releases" section in `CLAUDE.md`), and the manifest version is
   derived from it, so a normal release produces an upload-ready bump automatically.

## 3. The listing itself

Every field the dashboard asks for — name, summary, detailed description, category, single purpose,
a justification per permission, the data-usage answers and the note for the reviewer — is written
out ready to paste in **[`STORE-LISTING.md`](STORE-LISTING.md)**. Submitting should be transcription,
not composition, and one copy of that text means the listing and the repo cannot drift apart.

Two things it is worth knowing here:

- **Images come from [`store/`](store/), not `screenshots/`.** The store accepts screenshots at
  exactly 1280×800 or 640×400; `doc/screenshots/` is 1360×940 and 400×820 and would be refused.
  Regenerate with `npm run build && xvfb-run -a npm run store:assets`.
- **Privacy policy URL:** <https://amigouk.github.io/Research-Chrome-Extension/privacy.html> —
  **required**, because the extension requests broad optional host permissions. It is generated from
  `doc/PRIVACY.md` by `npm run pages` and served from `docs/` by GitHub Pages; regenerate and commit
  `docs/` whenever the policy changes.

## 4. Attach the zip to the GitHub release

Our release step uploads the same zip as a release asset, so a tag and its store upload are the same
bytes:

```bash
npm run package
gh release upload v<version> release/context-notes-v<version>.zip
```

(For a brand-new release, `gh release create v<version> … release/context-notes-v<version>.zip`
creates it and attaches the asset in one call.)
