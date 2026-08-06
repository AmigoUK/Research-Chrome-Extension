# Third-party notices

This extension bundles the following third-party assets. Their licences are reproduced in
[`doc/licenses/`](doc/licenses/) as those licences require.

## Fonts (bundled as woff2, loaded from the extension itself — never from a CDN)

| Font              | Used for                                                             | Licence                                                                                                | Copyright                     |
| ----------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Charis SIL**    | Display serif, when neither Iowan Old Style nor Charter is installed | SIL Open Font License 1.1 — [`doc/licenses/OFL-Charis-SIL.txt`](doc/licenses/OFL-Charis-SIL.txt)       | © 1997–2022 SIL International |
| **IBM Plex Mono** | Monospace, when iA Writer Mono is not installed                      | SIL Open Font License 1.1 — [`doc/licenses/OFL-IBM-Plex-Mono.txt`](doc/licenses/OFL-IBM-Plex-Mono.txt) | © 2017 IBM Corp.              |

Both are unmodified — only subset into `latin` and `latin-ext` woff2 by
[Fontsource](https://fontsource.org), which is how they arrive as npm packages. Neither is renamed,
so the OFL's reserved-font-name clause is not engaged.

## Citation styles

`src/assets/csl/*.csl` are unmodified styles from the [Citation Style Language styles
repository](https://github.com/citation-style-language/styles), licensed
**CC BY-SA 3.0** — [`doc/licenses/CC-BY-SA-3.0-csl-styles.txt`](doc/licenses/CC-BY-SA-3.0-csl-styles.txt).
They are data read by citeproc, not code.

## Libraries

| Library                                                                                                              | Licence                                                                     | Notes                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **citeproc-js** (the citation engine, bundled into the service worker)                                               | **CPAL-1.0 OR AGPL-1.0** — this project redistributes it under **CPAL-1.0** | © 2009–2019 Frank Bennett — [`doc/licenses/citeproc-CPAL-AGPL.txt`](doc/licenses/citeproc-CPAL-AGPL.txt). The CPAL attribution ("Citations by citeproc-js © Frank Bennett") is displayed in the dashboard footer. |
| `@citation-js/core`, `@citation-js/plugin-csl` (wrappers around citeproc)                                            | MIT                                                                         |                                                                                                                                                                                                                   |
| `pdfjs-dist` (pdf.js)                                                                                                | Apache-2.0                                                                  | © Mozilla — [`doc/licenses/Apache-2.0-pdfjs-dist.txt`](doc/licenses/Apache-2.0-pdfjs-dist.txt)                                                                                                                    |
| `idb`                                                                                                                | ISC                                                                         |                                                                                                                                                                                                                   |
| `dom-anchor-text-quote`, `dom-anchor-text-position`                                                                  | MIT                                                                         |                                                                                                                                                                                                                   |
| `diff-match-patch` (pulled in transitively by `dom-anchor-text-quote`, bundled into `dist/annotator.js`)             | Apache-2.0                                                                  | © The diff-match-patch Authors — [`doc/licenses/Apache-2.0-diff-match-patch.txt`](doc/licenses/Apache-2.0-diff-match-patch.txt)                                                                                   |
| `ieee754` (pulled in transitively by `@citation-js/core`'s `sync-fetch` dependency, bundled into the service worker) | BSD-3-Clause                                                                | © 2008 Fair Oaks Labs, Inc. — [`doc/licenses/BSD-3-Clause-ieee754.txt`](doc/licenses/BSD-3-Clause-ieee754.txt)                                                                                                    |

The extension's **own** code is MIT — see [`LICENSE`](LICENSE). Because citeproc-js is not
MIT, the shipped package as a whole is **not** "MIT-only"; store listings and docs must not
describe it that way.

Both transitive entries above were found by checking what actually ends up in `dist/`, not just
`package.json`'s direct dependencies — `package.json` only lists `dom-anchor-text-quote` and
`@citation-js/core`, and each pulls in its own dependency (unconditionally, at module load) that
carries a different licence from its parent.
