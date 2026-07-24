import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

/**
 * MV3 manifest.
 *
 * Permissions follow least privilege (architecture.md):
 * - `sidePanel` is the primary workflow surface.
 * - Host access is NOT granted by default. An all-URLs match pattern is
 *   declared only as an OPTIONAL host permission and requested per-origin
 *   at runtime (opt-in), so the extension holds no standing access to
 *   every site.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'Scientific Context Notes',
  version: pkg.version,
  description: pkg.description,
  minimum_chrome_version: '116',
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
