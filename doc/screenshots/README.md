# Screenshots

Every surface of the extension, captured from a real build against a seeded project. They are
referenced from the root [`README.md`](../../README.md).

Current set: **v0.25.0**, with the bundled OFL faces (Charis SIL for display, IBM Plex Mono for
labels) — so they show what a machine without Iowan Old Style or iA Writer Mono actually renders.

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

```bash
npm run build && npm run screenshots
```

`scripts/screenshots.mjs` loads `dist/` into a headed Chromium, seeds a project through the
extension's own messaging layer — so the data arrives the way a user's would — and walks every
surface. Run it after any change that alters how the app looks.

It was originally left out of the repo on the grounds that it was seed data with no test value.
That was wrong: the set has needed retaking twice already (an icon-sizing fix, then bundled fonts),
and rewriting the script each time costs more than keeping it.

Screenshots are documentation, not fixtures: nothing in the build or the test suite reads them, and
`dist/` contains no images from this folder.
