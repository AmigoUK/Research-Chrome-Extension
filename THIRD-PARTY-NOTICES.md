# Third-party notices

This extension bundles the following third-party assets. Their licences are reproduced in
[`doc/licenses/`](doc/licenses/) as those licences require.

## Fonts (bundled as woff2, loaded from the extension itself — never from a CDN)

| Font | Used for | Licence | Copyright |
|---|---|---|---|
| **Charis SIL** | Display serif, when neither Iowan Old Style nor Charter is installed | SIL Open Font License 1.1 — [`doc/licenses/OFL-Charis-SIL.txt`](doc/licenses/OFL-Charis-SIL.txt) | © 1997–2022 SIL International |
| **IBM Plex Mono** | Monospace, when iA Writer Mono is not installed | SIL Open Font License 1.1 — [`doc/licenses/OFL-IBM-Plex-Mono.txt`](doc/licenses/OFL-IBM-Plex-Mono.txt) | © 2017 IBM Corp. |

Both are unmodified — only subset into `latin` and `latin-ext` woff2 by
[Fontsource](https://fontsource.org), which is how they arrive as npm packages. Neither is renamed,
so the OFL's reserved-font-name clause is not engaged.

## Citation styles

`src/assets/csl/*.csl` are unmodified styles from the [Citation Style Language styles
repository](https://github.com/citation-style-language/styles), licensed
**CC BY-SA 3.0**. They are data read by citeproc, not code.

## Libraries

Runtime dependencies and their licences are declared in `package.json` / `package-lock.json`:
citeproc-js via `@citation-js/*` (MIT), `pdfjs-dist` (Apache-2.0), `idb` (ISC),
`dom-anchor-text-quote` / `dom-anchor-text-position` (MIT).
