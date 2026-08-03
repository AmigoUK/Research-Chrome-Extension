# Privacy Policy — Scientific Context Notes

_Last updated: 2026-08-03_

> This file is the source. The published policy — the URL given to the Chrome Web Store — is
> **<https://amigouk.github.io/Research-Chrome-Extension/privacy.html>**, generated from this file by
> `npm run pages`. Edit here, regenerate, and commit `docs/`; never edit `docs/privacy.html` directly.

Scientific Context Notes is a **local-first** Chrome extension. It is built so that your research
data never leaves your browser.

## What data the extension handles

Everything you create — projects, filed documents and PDFs, annotations and their anchored quotes,
references and citation styles, comments, and activity history — is stored **locally in this
browser's IndexedDB**. It stays on your device.

## What the extension does NOT do

- **No servers.** There is no backend. The extension never sends your data anywhere.
- **No telemetry or analytics.** Nothing about your usage is collected or transmitted.
- **No third-party sharing.** No data is sold, shared, or disclosed to anyone.
- **No accounts.** There is no sign-in and no user identifier.
- **No remote code.** Manifest V3 forbids it; every asset (citation styles, the PDF reader, the
  citation engine, fonts) is bundled inside the extension.

## Permissions and why they are used

- **`storage`** — to keep your projects and notes in local browser storage.
- **`activeTab` / `scripting`** — to inject the annotator into the page you are actively viewing,
  on demand, when you choose to annotate it.
- **`sidePanel`** — the extension's main workspace surface.
- **Optional host permissions (`*://*/*`)** — requested **per site, only when you choose to annotate
  there**, so the extension can read the text on that page to anchor your highlights. It is never
  granted up front, and the page content is only read locally to create your annotation — it is
  never transmitted.

## Network requests you initiate

Two optional features make a network request **only when you ask for one**, and only to the service
you named:

- **DOI import** contacts `doi.org` to fetch citation metadata for a DOI you enter.
- **Open PDF by URL** fetches a PDF from a URL you provide, to store it locally for annotation.

No other network activity occurs.

## Sharing your data

Collaboration is by **file**, not by server. When you export a project snapshot, it is written as a
local file (optionally password-encrypted) that **you** choose to share. The extension does not
upload it.

## Contact

Questions about this policy: **dev@attv.uk** ·
[github.com/AmigoUK/Research-Chrome-Extension](https://github.com/AmigoUK/Research-Chrome-Extension)
