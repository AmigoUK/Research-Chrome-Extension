# Screenshots

Every surface of the extension, captured from a real build against a seeded project. They are
referenced from the root [`README.md`](../../README.md).

| File | Screen |
|---|---|
| `01-overview.png` | Dashboard → Overview (stat tiles + Kanban) |
| `02-documents.png` | Dashboard → Documents |
| `03-annotations.png` | Dashboard → Annotations |
| `04-references.png` | Dashboard → References |
| `05-citation-styles.png` | Dashboard → Citation styles (compact) |
| `06-style-editor.png` | Full-screen style editor, live preview |
| `07-style-editor-csl.png` | Full-screen style editor, CSL override tab |
| `08-team-activity.png` | Team → Activity |
| `09-team-comments.png` | Team → Comments |
| `10-team-members.png` | Team → Members |
| `11-team-sync.png` | Team → Sync |
| `12-side-panel.png` | Side panel (capture + reading list) |
| `13-side-panel-status-menu.png` | Side panel with the status menu open |
| `14-pdf-reader.png` | PDF reader with an anchored annotation |

## Retaking them

They are produced by a Playwright script that loads `dist/` into a headed Chromium, seeds a project
through the extension's own messaging layer, and walks every view. The script is not kept in the
repo — it is a few dozen lines of seed data with no test value, and stale seed data ages worse than
no script. To retake a set, build first (`npm run build`), then drive the same paths the E2E suite
uses (`e2e/dashboard.spec.ts` shows the selectors) and write the PNGs here at 1360×940 for the
dashboard and reader, 400×820 for the side panel.

Screenshots are documentation, not fixtures: nothing in the build or the test suite reads them, and
`dist/` contains no images from this folder.
