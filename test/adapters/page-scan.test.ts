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

  it('prefers citation_author and ignores dc.creator when both exist — the MDPI double list', () => {
    document.head.innerHTML += `
      <meta name="dc.creator" content="Nowak, Anna">
      <meta name="dc.creator" content="Okafor, Mary">`;
    const { raw } = scanDocumentRaw();
    expect(raw.authors).toEqual(['Nowak, A.', 'Okafor, M.']);
  });

  it('falls back to dc.creator when no citation_author exists', () => {
    document.head.innerHTML = `
      <meta name="citation_title" content="A paper">
      <meta name="dc.creator" content="Nichol, Janet">`;
    const { raw } = scanDocumentRaw();
    expect(raw.authors).toEqual(['Nichol, Janet']);
  });

  it('reads schema.org Article JSON-LD as a fallback source', () => {
    document.head.innerHTML = `
      <script type="application/ld+json">not even json</script>
      <script type="application/ld+json">
        {"@graph": [
          {"@type": "WebSite", "name": "Ignore me"},
          {"@type": "ScholarlyArticle",
           "headline": "Heat and the city",
           "author": [{"@type": "Person", "name": "Ada Byron"}, "Grace Hopper"],
           "datePublished": "2019-04-01",
           "isPartOf": {"@type": "Periodical", "name": "Urban Climate"},
           "publisher": {"@type": "Organization", "name": "Elsevier"}}
        ]}
      </script>`;
    const { raw } = scanDocumentRaw();
    expect(raw.jsonLd).toEqual({
      title: 'Heat and the city',
      authors: ['Ada Byron', 'Grace Hopper'],
      date: '2019-04-01',
      journal: 'Urban Climate',
      publisher: 'Elsevier',
    });
    // And the pure builder uses it when the meta tags are silent.
    const input = buildCaptureInput(scanDocumentRaw(), 'p1');
    expect(input.metadata.title).toBe('Heat and the city');
    expect(input.metadata.authors).toEqual(['Ada Byron', 'Grace Hopper']);
    expect(input.metadata.year).toBe(2019);
    expect(input.metadata.journal).toBe('Urban Climate');
    expect(input.type).toBe('article');
  });

  it('lets meta tags win over JSON-LD', () => {
    document.head.innerHTML += `
      <script type="application/ld+json">
        {"@type": "Article", "headline": "The wrong title", "datePublished": "1999"}
      </script>`;
    const input = buildCaptureInput(scanDocumentRaw(), 'p1');
    expect(input.metadata.title).toBe('Nocturnal UHI and mortality');
    expect(input.metadata.year).toBe(2023);
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
