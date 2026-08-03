# Chrome Web Store listing images

The images uploaded to the [Web Store listing](../STORE-LISTING.md). They are **not** the README
screenshots: the store accepts screenshots at exactly **1280×800** or **640×400** and refuses
anything else, while [`doc/screenshots/`](../screenshots/) is 1360×940 and 400×820 because a
document is read at a different size than a store carousel.

| File | Size | Store field |
|---|---|---|
| `screenshot-1-overview.png` | 1280×800 | Screenshot 1 |
| `screenshot-2-annotations.png` | 1280×800 | Screenshot 2 |
| `screenshot-3-citation-styles.png` | 1280×800 | Screenshot 3 |
| `screenshot-4-pdf-reader.png` | 1280×800 | Screenshot 4 |
| `screenshot-5-side-panel.png` | 1280×800 | Screenshot 5 |
| `promo-small-440x280.png` | 440×280 | Small promo tile |
| `promo-marquee-1400x560.png` | 1400×560 | Marquee (only shown if the item is featured) |

The 128×128 store icon is not here — it ships in the build, from
[`src/assets/icons/icon-128.png`](../../src/assets/icons/icon-128.png).

## Regenerating them

```bash
npm run build && xvfb-run -a npm run store:assets
```

`scripts/store-assets.mjs` loads `dist/` into a headed Chromium, seeds the same demo project the
README screenshots use (`scripts/lib/seed-demo-project.mjs` — shared, so the listing and the repo
never show two different products), photographs each surface at 2× device pixels and composes it
into a captioned 1280×800 frame. Capturing at 2× and placing the result at 1120 CSS pixels is what
keeps the UI crisp after the downscale.

Two things are deliberate and worth knowing before you "fix" them:

- **The side panel is composed, not cropped.** It is 400 px wide by design, which is not a legal
  screenshot shape, so it sits on the canvas beside its caption rather than being stretched.
- **Wide surfaces are captured 24 px taller than they are shown.** The extra strip is cropped off
  the bottom, because a viewport-height cut lands mid-line through the app's own footer.

The script asserts every output's dimensions from the PNG header and fails if one is off, so a
layout change that pushes an image out of spec is caught here rather than at upload.
