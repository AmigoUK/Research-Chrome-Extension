# Citation and Bibliography System

This document details how citations and bibliographies are generated using CSL and user-defined rules.

## CSL Integration

- The extension uses Citation Style Language (CSL) as the core formatting engine for citations and bibliographies, leveraging existing CSL style repositories (e.g. Zotero style repository).
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

Internally, these rules are stored in `CitationStyle.userRules` and translated to CSL overrides or applied as post-processing on CSL output.
