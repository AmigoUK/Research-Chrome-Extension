# Data Model

This document specifies the logical data model used by the extension. The implementation can be in IndexedDB or SQLite, but the schema is technology-agnostic.

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
- `anchor`: descriptor of where the note is attached (text range, CSS selector, element ID, PDF page and coordinates).
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
