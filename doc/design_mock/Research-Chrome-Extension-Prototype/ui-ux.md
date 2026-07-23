# UI and UX Design

This document outlines the main user interfaces and interaction flows.

## UI Surfaces

- **Sidebar / Overlay** on annotated pages and PDFs.
- **Inline toolbar** for selections (text, tables, charts).
- **Browser action popup** for quick project and citation actions.
- **Dashboard (options page)** for full project and library management.

## Sidebar / Overlay

Functions:
- Display all annotations for the current page grouped by project and section.
- Allow filtering by tags, status, and author.
- Provide in-place editing of notes and workflow status.
- Show linked references and quick copy buttons for citations.

Behaviour:
- Appears when the user activates the extension on a page or automatically for pages already associated with a project.
- Highlights anchored portions of the page and scrolls to them when the user selects an annotation.

## Inline Toolbar

Functions:
- Appears when the user selects text or interacts with a supported element (e.g. table, figure).
- Offers actions: `Add note`, `Highlight`, `Link to project section`.

Anchoring:
- For text, uses range-based anchoring similar to web annotation tools.
- For DOM elements, stores CSS selectors or stable identifiers.
- For PDFs, uses page number and coordinates from the viewer.

## Popup (Browser Action)

Functions:
- Shows current active project and allows switching projects.
- Shows summary of the current page: associated document, number of annotations, reference status.
- Provides copy buttons:
  - `Copy in-text citation`.
  - `Copy footnote citation`.
  - `Copy bibliographic entry`.

## Dashboard

Sections:
- **Projects**: list, creation, deletion, and configuration (sections, default styles, members).
- **Documents**: per project, with status, section, and quick navigation to source.
- **Annotations**: searchable/filterable list across the project.
- **References**: bibliographic records, import/export, source information.
- **Citation Styles**: style profiles, base style selection, rule editor.

Workflow Views:
- Kanban-style view per project: `To read`, `In review`, `Analysed`, `Used in output` for documents.
- Counters per status to track progress on literature review or investigation.
