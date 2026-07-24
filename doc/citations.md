# Citation and Bibliography System

This document details how citations and bibliographies are generated using CSL and user-defined rules.

## CSL Integration

- The extension uses Citation Style Language (CSL) as the core formatting engine for citations and bibliographies. The **citeproc-js** engine and its **locale** files are **bundled locally** as extension assets — MV3's CSP forbids loading or executing remote code, so the engine is never fetched from a CDN.
- CSL **styles** (`.csl`) are treated as *data*, not code. Six ship with the extension — APA, Harvard, Vancouver, MLA and Chicago in both author–date and notes form — vendored under `src/assets/csl`. Since **v0.18.1** they are **not** inlined into the bundle: each is emitted as a separate extension asset and fetched on first use (`src/adapters/citation/csl-assets.ts`), so a session that formats APA never loads the 243 kB Chicago notes file. Since **v0.19.0** a third-party `.csl` file can be imported as a base style (**Citation styles → Full editor → Import .csl**); it is validated on import and stored in IndexedDB. An imported style is registered with citeproc under a name carrying a hash of its XML, because citation-js caches engines by template name — re-importing an updated file therefore takes effect immediately.
- Each `Reference` stores bibliographic data as CSL JSON (`cslData`).
- A `CitationStyle` profile combines a base CSL style (`baseStyleId`) with optional overrides and user-facing rules.

## Citation Generation Flow

1. User requests a citation (from popup, sidebar, or dashboard).
2. Service worker retrieves the relevant `Reference.cslData` and associated `CitationStyle`.
3. The CSL engine formats the citation according to the base style plus any overrides.
4. The extension applies user rules (e.g. author list truncation, et al behaviour) when necessary.
5. The formatted citation text is put into the clipboard for pasting into documents.

Supported outputs:
- In-text citations (author-date, numeric, etc.).
- Footnote-style citations.
- Full bibliographic entries.

## Bibliography Generation

- Bibliographies are generated per project or per section (e.g. only `Methods` documents).
- The extension collects all `Reference` entities matching the selection criteria.
- The CSL engine produces a formatted bibliography block which can be copied as plain text, HTML, or Markdown.

## User-Defined Rules

Users can configure citation behaviour without directly editing CSL:

- Maximum number of authors shown in citations.
- Whether to use `et al.` and how it is formatted.
- Choice between author-date and footnote systems.
- Inclusion or exclusion of DOIs and URLs in bibliographies.
- Special handling for FOI requests and legal cases (custom fields and templates).

Internally, these rules are stored in `CitationStyle.userRules` and **compiled to a small CSL override layer** on top of the base style, which the service worker applies through citeproc when formatting — no hand-editing of CSL XML is required. The rule → override contract (validated by the `citation-style-editor.html` prototype) maps:

| User rule | CSL override |
|---|---|
| Maximum authors | `et-al-min` (= max + 1) |
| Names before "et al." | `et-al-use-first` |
| Final name joiner | `name-and` (`symbol` / `text`) |
| Include DOI / DOI as URI | `include-doi` / `doi-as-uri` |
| Include URL when no DOI | `url-if-no-doi` |
| Include issue number | `include-issue` |
| Page range prefix (`pp.`) | `page-range-prefix` |

Supported citation systems: **author–date**, **footnote**, and **numeric**.

**FOI requests** and **legal cases** are first-class custom templates (`foi-request`, `legal-case`), with their own fields (authority, reference, request/response dates; neutral citation, court, year) — see the "Special sources" rules.
