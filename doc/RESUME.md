# Resume — session handoff

_Snapshot: 2026-08-03 · release **v1.0.0** · branch `main` (synced with origin) · working tree clean._

A fast-start pointer for the next session. Canonical detail lives in `doc/STATUS.md`, `CHANGELOG.md`,
and the git history — this file is just the "where we are and what's next" so you don't re-derive it.

## Where things stand

- **All five roadmap phases + the polish list are delivered.** No unmerged work.
- **Green:** 309 unit + 28 E2E, typecheck + lint clean. CI: typecheck → lint → unit → build (+ E2E job).
- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Published site:** https://amigouk.github.io/Research-Chrome-Extension/ (GitHub Pages, from `docs/`)
- **Latest work:** **v1.0.0 — everything the Chrome Web Store needs except the upload.**
  - `npm run package` builds the zip **and validates it** against the store's upload rules
    (`scripts/lib/store-package-rules.mjs`, 17 unit tests).
  - `npm run store:assets` → `doc/store/`: five 1280×800 screenshots, a 440×280 tile, a 1400×560
    marquee. The store refuses anything else, and `doc/screenshots/` is the wrong size for all of it.
  - `npm run pages` → `docs/`: the landing page and the **privacy policy**, generated from
    `doc/PRIVACY.md` and live at `/privacy.html`. Required for the broad optional host permissions.
  - `doc/STORE-LISTING.md` — every dashboard field written out to paste.

## Open — MANUAL, needs a human (can't be automated here)

1. **Submit to the Chrome Web Store.** Everything is prepared; what remains is the account and the
   clicking.
   - Needs a CWS **developer account** (one-off 5 USD registration) with a verified contact email.
   - Upload `release/context-notes-v1.0.0.zip` — regenerate with `npm run package`, or take the
     asset attached to the v1.0.0 GitHub release (same bytes).
   - Fill the listing from **`doc/STORE-LISTING.md`**, upload the images from **`doc/store/`**, and
     give the privacy-policy URL <https://amigouk.github.io/Research-Chrome-Extension/privacy.html>.
   - `doc/DISTRIBUTION.md` has the end-to-end steps.
2. **Thorough manual test in real Chrome** — the parts E2E can't drive (native permission prompts,
   real sites). Load `dist/` unpacked (`chrome://extensions`, Developer mode) and check:
   - Production activation: side panel → **"Annotate this page"** → native host-permission consent (Allow).
   - **A8:** click **Deny** → highlight still saved, in-page notice shows, prompt returns on next highlight.
   - **A2 SPA** on a real single-page app; **A3** on a site using open shadow DOM.
   - **A5:** a note under "Couldn't place on this page" has no "Jump to".
   - **DOI import** and **Open PDF by URL** (real network; incl. errors — bad DOI, HTML instead of PDF).
   - Browser priority: Chrome → Edge (Firefox out of scope).

## Candidate next work (pick per user intent)

- **Test isolation in `e2e/webannotation.spec.ts`.** The file is green in a full-suite run but its
  first test fails **every time** when the file is run on its own
  (`npx playwright test e2e/webannotation.spec.ts` → the overlay has no bounding box). It depends on
  state an earlier spec leaves behind. Pre-existing, not a product bug, but it makes the file
  undebuggable in isolation and it is the same file that flakes occasionally in full runs.
- **Deferred by design (see `doc/STATUS.md` "Deferred by design"):** `CitationStyle.cslOverride`
  persistence (won't-do — duplicates `userRules`); per-annotation **"section"** field + link-to-section
  (needs an IDB schema migration — append-only, bump `DB_VERSION`); **Presence** (needs a live backend —
  out of scope by the local-first decision).
- **Article/interview:** `doc/developer-interview.md` is committed; still user-owned — the section-1
  opening anecdote is a Claude-written DRAFT (`DO WERYFIKACJI`) to replace with a real story, and an
  optional section-16 case study after the first real project.
- **After the store listing goes live:** add the store badge/link to `README.md` and `docs/index.html`.

## How to start (the working pattern that worked in these sessions)

- Commands: `npm run dev` (HMR; load `dist/` unpacked) · `npm run dev:annotator` (watch the separate
  annotator bundle) · `npm test` · `npm run test:e2e` · `npm run build` · `npm run package` ·
  `xvfb-run -a npm run store:assets` · `npm run pages`.
- **Process for any non-trivial change:** brainstorm (superpowers) → spec in `doc/superpowers/specs/`
  → plan in `doc/superpowers/plans/` → execute via **subagent-driven development** (fresh implementer
  per task, task review, final whole-branch review) with **TDD**. Small glue tweaks were done directly
  on `main` with a full pre-flight + one independent diff review.
- **Architecture guardrails** (see `CLAUDE.md`): `src/core` is pure (no `chrome.*`/IDB/DOM, except
  `src/core/anchoring/web.ts`); surfaces send typed messages to the SW's pure `handleRequest`;
  migrations are append-only; escape at the sink; a `position: fixed` popover repositions on scroll,
  it does not close.
- **Release flow** (`CLAUDE.md` "Releases"): bump `package.json` → CHANGELOG section → update README +
  `doc/STATUS.md` → `chore(release)`/`feat`/`fix` commit → tag → `git push --follow-tags` →
  `gh release create`; for store-facing releases also `npm run package` + attach the zip, and
  `npm run pages` so the published site's version footer keeps up.

## Known-benign, deferred (don't re-litigate without reason)

- Packaging uses the system `zip`/`unzip` (no dep) — needs both on PATH (fine on Linux/macOS/CI).
- `npm run store:assets` needs a headed Chromium; run it under `xvfb-run` in a headless environment.
- A8: two rapid denials could briefly stack two notices; a denied opt-in re-prompts on each later
  highlight (intended — silent failure is worse); a near-zero-window concurrent double
  `permissions.request` (SW `registerOrigin` is idempotent).
- E2E under headed Chromium/xvfb flakes occasionally (`webannotation.spec.ts` did so once on
  2026-08-03, then passed clean); re-run before treating a single red as a regression.
