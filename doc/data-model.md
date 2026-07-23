# Data Model

This document specifies the logical data model used by the extension. The store is **IndexedDB** (see `architecture.md`); the schema below is described at a logical level.

The persisted schema is **versioned**: a schema-version number is stored alongside the data, and migrations run in the IndexedDB `onupgradeneeded` handler so the shape can evolve across releases without losing user data.

All entities except the `Annotation.anchor` field below are validated 1:1 against the design prototypes (`research-dashboard.html`, `citation-style-editor.html`, `collaboration-sync.html`) — including `Project.members` / `rolesPerProject`, `Reference.source`, `Reference.usedInOutputs`, and the annotation status values.

## Core Entities

### Project

Represents a research project or investigation.

Fields:
- `id`: unique identifier.
- `name`: project name.
- `description`: free-text description.
- `defaultCitationStyleId`: link to a `CitationStyle`.
- `sections`: list of section definitions (e.g. `Literature`, `Methods`, `Data`, `FOI`, `Report`).
- `members`: list of user-role pairs for collaboration.
- `createdAt`, `updatedAt`.

### Document

Represents an online source or file associated with a project.

Fields:
- `id`: unique identifier.
- `projectId`: FK to `Project`.
- `url`: canonical URL of the source.
- `fileId`: optional pointer to a local PDF or cached file.
- `type`: enum, e.g. `article`, `report`, `dataset`, `foi`, `case`, `webPage`.
- `metadata`: structured bibliographic data (DOI, title, authors, year, journal, publisher, identifiers).
- `status`: workflow status, e.g. `toRead`, `inReview`, `analysed`, `usedInOutput`.
- `section`: logical section within project.

### Annotation

Represents a note tied to a specific part of a document.

Fields:
- `id`: unique identifier.
- `projectId`, `documentId`: links to context.
- `anchor`: a **list of anchoring strategies with a defined fallback order**, keyed by document type, following the W3C Web Annotation model:
  - **web (reflowable pages)** — `textQuoteSelector` (quoted text + prefix/suffix), `textPositionSelector` (character offsets), and a `cssSelector` for DOM elements, resolved in that order. Pure coordinate rectangles are avoided here because they do not survive reflow.
  - **PDF (fixed layout)** — `page` plus **percent-coordinate rectangles** (fractions of the page box), plus a text quote / element id where available. Percent rects survive zoom and re-anchor reliably on reload (validated by the `pdf-anchoring.html` prototype).
- `content`: text of the note.
- `tags`: list of tags.
- `status`: workflow status, e.g. `draft`, `accepted`, `rejected`, `includedInReport`.
- `author`: user id.
- `createdAt`, `updatedAt`.

### Reference

Bibliographic record used for citation and bibliography generation.

Fields:
- `id`: unique identifier.
- `projectId`: FK to `Project`.
- `documentId`: optional link to `Document`.
- `cslData`: CSL JSON representing full bibliographic metadata.
- `source`: origin of metadata (`extractedFromPage`, `importedFromZotero`, `manual`).
- `usedInOutputs`: list of identifiers of outputs (reports, papers) where this reference is used.

### CitationStyle

Represents a citation style profile based on CSL.

Fields:
- `id`: unique identifier.
- `name`: human-readable name (e.g. `Harvard – Institution X`).
- `baseStyleId`: identifier of the base CSL style (e.g. a Zotero style ID).
- `cslOverride`: partial CSL JSON/XML overriding the base style.
- `userRules`: high-level user-facing rules (max authors, et al behaviour, footnote vs author-date, DOI/URL inclusion, etc.).

### User

Represents a local user or collaborator.

Fields:
- `id`: unique identifier.
- `name`: display name.
- `email`: optional.
- `rolesPerProject`: mapping project -> role.

## Relationships

- One `Project` has many `Documents`, `Annotations`, `References`, and users with roles.
- One `Document` belongs to one `Project` and may have many `Annotations` and one or more `References`.
- One `Reference` belongs to one `Project` and optionally to one `Document`.
- One `CitationStyle` can be used as `defaultCitationStyleId` in multiple projects.
