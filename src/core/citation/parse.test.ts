import { describe, it, expect } from 'vitest';
import { CUSTOM_BASE_PREFIX, customBaseStyleId, isCustomBaseStyleId, parseCslStyle } from './parse';

const NS = 'http://purl.org/net/xbiblio/csl';

function cslFile(over: { title?: string; format?: string; extra?: string } = {}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="${NS}" class="in-text" version="1.0">
  <info>
    <title>${over.title ?? 'Journal of Testing'}</title>
    ${over.format ? `<category citation-format="${over.format}"/>` : ''}
    ${over.extra ?? ''}
  </info>
  <macro name="author"><names variable="author"/></macro>
  <citation><layout><text macro="author"/></layout></citation>
</style>`;
}

describe('parseCslStyle', () => {
  it('reads the title and maps the declared citation format to a system', () => {
    expect(parseCslStyle(cslFile({ format: 'author-date' }))).toMatchObject({
      title: 'Journal of Testing',
      system: 'authorDate',
      citationFormat: 'author-date',
    });
    expect(parseCslStyle(cslFile({ format: 'note' })).system).toBe('footnote');
    expect(parseCslStyle(cslFile({ format: 'numeric' })).system).toBe('numeric');
    expect(parseCslStyle(cslFile({ format: 'label' })).system).toBe('numeric');
  });

  it('falls back to author–date when the file declares no format', () => {
    const parsed = parseCslStyle(cslFile());
    expect(parsed.system).toBe('authorDate');
    expect(parsed.citationFormat).toBeUndefined();
  });

  it('decodes XML entities in the title', () => {
    expect(parseCslStyle(cslFile({ title: 'Ecology &amp; Society' })).title).toBe(
      'Ecology & Society',
    );
  });

  it('names an untitled style rather than leaving it blank', () => {
    const untitled = cslFile().replace(/<title>[^<]*<\/title>/, '');
    expect(parseCslStyle(untitled).title).toBe('Imported style');
  });

  it('refuses files that are not CSL, with a reason the user can act on', () => {
    expect(() => parseCslStyle('')).toThrow(/empty/);
    expect(() => parseCslStyle('<html><body>hello</body></html>')).toThrow(/no <style> element/);
    expect(() => parseCslStyle('<style xmlns="http://example.com/other"/>')).toThrow(
      /wrong or missing namespace/,
    );
  });

  it('refuses a dependent style — citeproc cannot format with one', () => {
    const dependent = `<style xmlns="${NS}" class="in-text"><info><title>Dependent</title>
      <link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info></style>`;
    expect(() => parseCslStyle(dependent)).toThrow(/dependent style/);
  });

  it('refuses a style with no citation rules', () => {
    const empty = `<style xmlns="${NS}" class="in-text"><info><title>Hollow</title></info></style>`;
    expect(() => parseCslStyle(empty)).toThrow(/no citation rules/);
  });
});

describe('custom base style ids', () => {
  it('slugs a title and marks the id as imported', () => {
    expect(customBaseStyleId('Journal of Testing')).toBe(`${CUSTOM_BASE_PREFIX}journal-of-testing`);
    expect(customBaseStyleId('Ecology & Society')).toBe(`${CUSTOM_BASE_PREFIX}ecology-society`);
    expect(customBaseStyleId('!!!')).toBe(`${CUSTOM_BASE_PREFIX}style`);
  });

  it('tells an imported id from a vendored one', () => {
    expect(isCustomBaseStyleId(customBaseStyleId('Nature'))).toBe(true);
    expect(isCustomBaseStyleId('apa')).toBe(false);
    expect(isCustomBaseStyleId('chicago-note')).toBe(false);
  });

  it('keeps ids short enough to stay readable', () => {
    const id = customBaseStyleId('A'.repeat(200));
    expect(id.length).toBeLessThanOrEqual(CUSTOM_BASE_PREFIX.length + 48);
  });
});
