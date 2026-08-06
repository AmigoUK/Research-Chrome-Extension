import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * MV3 manifest.
 *
 * Permissions follow least privilege (architecture.md):
 * - `sidePanel` is the primary workflow surface.
 * - Host access is NOT granted by default. An all-URLs match pattern is
 *   declared only as an OPTIONAL host permission, requested at runtime on a
 *   user gesture, never at install time. Two distinct grants share it: a
 *   per-origin request the first time the user annotates a given site (the
 *   annotator then auto-loads on that site alone), and a separate standing
 *   all-sites request from the side panel's "Allow reading pages" button,
 *   which lets the capture preview and the annotator auto-load on whatever
 *   tab is active — needed because `activeTab` is scoped to the one tab
 *   where the toolbar icon was clicked and is revoked on navigation. Either
 *   grant is revocable per site or wholesale in chrome://extensions.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Scientific Context Notes',
  version: pkg.version,
  // This string IS the summary the Chrome Web Store shows under the name in
  // search results — not internal documentation. It must read for a researcher
  // deciding whether to install, and it must stay within the store's 132-char
  // limit (`scripts/lib/store-package-rules.mjs` fails the build past it).
  description: pkg.description,
  minimum_chrome_version: '116',
  homepage_url: 'https://github.com/AmigoUK/Research-Chrome-Extension',
  // Generated from `src/assets/icons/icon.svg` (and `icon-small.svg` for the two
  // toolbar sizes, whose motif is drawn for the size it is actually seen at).
  icons: {
    16: 'src/assets/icons/icon-16.png',
    32: 'src/assets/icons/icon-32.png',
    48: 'src/assets/icons/icon-48.png',
    128: 'src/assets/icons/icon-128.png',
  },
  permissions: ['storage', 'scripting', 'activeTab', 'sidePanel'],
  optional_host_permissions: ['*://*/*'],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  action: {
    default_title: 'Open Context Notes',
    default_icon: {
      16: 'src/assets/icons/icon-16.png',
      32: 'src/assets/icons/icon-32.png',
      48: 'src/assets/icons/icon-48.png',
      128: 'src/assets/icons/icon-128.png',
    },
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  // No `web_accessible_resources`. The PDF reader is opened from an extension
  // page (`window.open` on a `chrome-extension://` URL) and the CSL assets are
  // fetched same-origin by the service worker, so nothing here needs to be
  // reachable from a web page. Declaring `assets/*` for `<all_urls>` would let
  // any site probe for this extension and read its assets — a poor trade for a
  // tool whose point is that data stays on the machine.
});
