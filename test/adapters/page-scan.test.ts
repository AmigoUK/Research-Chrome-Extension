// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { scanDocumentRaw, buildCaptureInput } from '../../src/adapters/chrome/page-scan';

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="citation_title" content="Nocturnal UHI and mortality">
    <meta name="citation_doi" content="10.1234/uhi.2023">
    <meta name="citation_author" content="Nowak, A.">
    <meta name="citation_author" content="Okafor, M.">
    <meta name="citation_journal_title" content="J. Urban Climate">
    <meta name="citation_publication_date" content="2023">
    <link rel="canonical" href="https://example.org/canonical">`;
  document.title = 'Fallback Title';
});

describe('scanDocumentRaw', () => {
  it('collects meta tags, authors, title, and canonical URL', () => {
    const { url, raw } = scanDocumentRaw();
    expect(url).toBe('https://example.org/canonical');
    expect(raw.title).toBe('Fallback Title');
    expect(raw.authors).toEqual(['Nowak, A.', 'Okafor, M.']);
    expect(raw.metaTags?.['citation_doi']).toBe('10.1234/uhi.2023');
  });
});

describe('buildCaptureInput', () => {
  it('turns a scan into a typed capture input', () => {
    const input = buildCaptureInput(scanDocumentRaw(), 'p1', 'Literature');
    expect(input.projectId).toBe('p1');
    expect(input.url).toBe('https://example.org/canonical');
    expect(input.type).toBe('article');
    expect(input.section).toBe('Literature');
    expect(input.metadata.title).toBe('Nocturnal UHI and mortality');
    expect(input.metadata.doi).toBe('10.1234/uhi.2023');
    expect(input.metadata.year).toBe(2023);
  });
});
