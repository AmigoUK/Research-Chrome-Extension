import { describe, expect, it } from 'vitest';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  validateStorePackage,
} from '../scripts/lib/store-package-rules.mjs';

/**
 * The rules mirror what the Chrome Web Store rejects at upload time. Every case
 * below is a rejection we would otherwise only discover by uploading — which
 * costs a round trip through a dashboard we cannot script.
 */

const ICONS = {
  16: 'src/assets/icons/icon-16.png',
  32: 'src/assets/icons/icon-32.png',
  48: 'src/assets/icons/icon-48.png',
  128: 'src/assets/icons/icon-128.png',
};

function goodManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: 3,
    name: 'Scientific Context Notes',
    version: '1.0.0',
    description: 'File pages and PDFs into research projects and cite them.',
    icons: { ...ICONS },
    permissions: ['storage', 'scripting', 'activeTab', 'sidePanel'],
    optional_host_permissions: ['*://*/*'],
    background: { service_worker: 'service-worker-loader.js', type: 'module' },
    action: { default_title: 'Open Context Notes', default_icon: { ...ICONS } },
    side_panel: { default_path: 'src/sidepanel/index.html' },
    options_page: 'src/options/index.html',
    ...overrides,
  };
}

function goodFiles(extra: string[] = []) {
  return [
    'manifest.json',
    'service-worker-loader.js',
    'annotator.js',
    'src/sidepanel/index.html',
    'src/options/index.html',
    'src/pdfviewer/index.html',
    ...Object.values(ICONS),
    'assets/index-abc123.js',
    'assets/apa-DNpd5vHN.csl',
    ...extra,
  ];
}

function validate(overrides: Record<string, unknown> = {}, extraFiles: string[] = []) {
  return validateStorePackage({
    manifest: goodManifest(overrides),
    files: goodFiles(extraFiles),
    expectedVersion: '1.0.0',
  });
}

describe('validateStorePackage', () => {
  it('passes a well-formed package', () => {
    const report = validate();
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('rejects a description over the store limit', () => {
    const report = validate({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) });
    expect(report.errors.join('\n')).toMatch(/description/i);
  });

  it('accepts a description exactly at the limit', () => {
    const report = validate({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH) });
    expect(report.errors).toEqual([]);
  });

  it('rejects an empty description', () => {
    const report = validate({ description: '   ' });
    expect(report.errors.join('\n')).toMatch(/description/i);
  });

  it('rejects a name over the hard limit and warns past the display limit', () => {
    expect(validate({ name: 'x'.repeat(76) }).errors.join('\n')).toMatch(/name/i);
    const long = validate({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) });
    expect(long.errors).toEqual([]);
    expect(long.warnings.join('\n')).toMatch(/name/i);
  });

  it('rejects a manifest that is not MV3', () => {
    expect(validate({ manifest_version: 2 }).errors.join('\n')).toMatch(/manifest_version/);
  });

  it('rejects a version that does not match package.json', () => {
    const report = validateStorePackage({
      manifest: goodManifest({ version: '0.28.0' }),
      files: goodFiles(),
      expectedVersion: '1.0.0',
    });
    expect(report.errors.join('\n')).toMatch(/0\.28\.0.*1\.0\.0|1\.0\.0.*0\.28\.0/);
  });

  it('rejects a malformed version', () => {
    expect(validate({ version: '1.0.0-rc1' }).errors.join('\n')).toMatch(/version/i);
    expect(validate({ version: '1' }).errors.join('\n')).toMatch(/version/i);
    expect(validate({ version: '1.0.99999' }).errors.join('\n')).toMatch(/version/i);
  });

  it('rejects a missing icon size', () => {
    const icons = { ...ICONS } as Record<string, string>;
    delete icons['128'];
    expect(validate({ icons }).errors.join('\n')).toMatch(/128/);
  });

  it('rejects an icon that is declared but absent from the archive', () => {
    const report = validateStorePackage({
      manifest: goodManifest(),
      files: goodFiles().filter((f) => f !== ICONS[48]),
      expectedVersion: '1.0.0',
    });
    expect(report.errors.join('\n')).toMatch(/icon-48\.png/);
  });

  it('rejects a referenced surface that is absent from the archive', () => {
    const report = validateStorePackage({
      manifest: goodManifest(),
      files: goodFiles().filter((f) => f !== 'src/sidepanel/index.html'),
      expectedVersion: '1.0.0',
    });
    expect(report.errors.join('\n')).toMatch(/sidepanel\/index\.html/);
  });

  it('rejects smuggled source maps', () => {
    expect(validate({}, ['assets/index-abc123.js.map']).errors.join('\n')).toMatch(/\.map/);
  });

  it('rejects development and OS junk', () => {
    expect(validate({}, ['node_modules/idb/package.json']).errors.join('\n')).toMatch(
      /node_modules/,
    );
    expect(validate({}, ['.vite/manifest.json']).errors.join('\n')).toMatch(/\.vite/);
    expect(validate({}, ['src/.DS_Store']).errors.join('\n')).toMatch(/DS_Store/);
    expect(validate({}, ['._icon.png']).errors.join('\n')).toMatch(/\._icon\.png/);
  });

  it('rejects an archive whose manifest is not at the root', () => {
    const report = validateStorePackage({
      manifest: goodManifest(),
      files: goodFiles()
        .filter((f) => f !== 'manifest.json')
        .concat('dist/manifest.json'),
      expectedVersion: '1.0.0',
    });
    expect(report.errors.join('\n')).toMatch(/root/i);
  });

  it('warns about a permission the store listing does not justify', () => {
    const report = validate({
      permissions: ['storage', 'scripting', 'activeTab', 'sidePanel', 'tabs'],
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings.join('\n')).toMatch(/tabs/);
  });

  it('warns about a host permission granted up front', () => {
    const report = validate({ host_permissions: ['*://*/*'] });
    expect(report.warnings.join('\n')).toMatch(/host_permissions/);
  });

  it('reports a manifest that is not an object rather than throwing', () => {
    const report = validateStorePackage({ manifest: null, files: [], expectedVersion: '1.0.0' });
    expect(report.errors.length).toBeGreaterThan(0);
  });
});
