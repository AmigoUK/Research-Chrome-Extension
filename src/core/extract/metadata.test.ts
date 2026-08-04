import { describe, it, expect } from 'vitest';
import {
  findDoi,
  buildDocumentMetadata,
  inferDocumentType,
  isSearchPage,
  toCslData,
} from './metadata';

describe('findDoi', () => {
  it('extracts and normalises a DOI from varied candidates', () => {
    expect(findDoi(['doi:10.1000/XyZ'])).toBe('10.1000/xyz');
    expect(findDoi(['https://doi.org/10.1007/s00484-009-0256-x'])).toBe(
      '10.1007/s00484-009-0256-x',
    );
    expect(findDoi([undefined, 'no doi here', '10.1/abc'])).toBe('10.1/abc');
  });

  it('returns undefined when no DOI is present', () => {
    expect(findDoi(['just text', undefined, null])).toBeUndefined();
  });
});

describe('buildDocumentMetadata', () => {
  it('reads citation_* meta tags and parses the year', () => {
    const meta = buildDocumentMetadata({
      title: 'Fallback title',
      authors: ['Tan, J.'],
      metaTags: {
        citation_title: 'The urban heat island in Shanghai',
        citation_doi: '10.1007/s00484-009-0256-x',
        citation_publication_date: '2010/03/15',
        citation_journal_title: 'Int. J. Biometeorology',
      },
    });
    expect(meta.title).toBe('The urban heat island in Shanghai');
    expect(meta.doi).toBe('10.1007/s00484-009-0256-x');
    expect(meta.year).toBe(2010);
    expect(meta.journal).toBe('Int. J. Biometeorology');
    expect(meta.authors).toEqual(['Tan, J.']);
  });

  it('falls back to the document title when no citation_title', () => {
    expect(buildDocumentMetadata({ title: 'Plain page' }).title).toBe('Plain page');
  });
});

describe('inferDocumentType', () => {
  it('classifies scholarly sources as articles', () => {
    expect(inferDocumentType({ doi: '10.1/x' })).toBe('article');
    expect(inferDocumentType({ journal: 'Nature' })).toBe('article');
    expect(inferDocumentType({ title: 'A blog post' })).toBe('webPage');
  });
});

describe('isSearchPage', () => {
  // The exact URL that motivated the guard, captured from a live session:
  // filing it stored "«query» - Google Scholar" as a source's title.
  const SCHOLAR_SERP =
    'https://scholar.google.com/scholar?hl=en&as_sdt=0%2C5&q=urban+heat+island+effect&btnG=';

  it('flags scholarly and web search surfaces', () => {
    expect(isSearchPage(SCHOLAR_SERP, {})).toBe(true);
    expect(isSearchPage('https://www.google.com/search?q=urban+heat', {})).toBe(true);
    expect(isSearchPage('https://duckduckgo.com/?q=uhi', {})).toBe(true);
    expect(isSearchPage('https://pubmed.ncbi.nlm.nih.gov/?term=heat+island', {})).toBe(true);
    expect(isSearchPage('https://www.sciencedirect.com/search?qs=heat', {})).toBe(true);
    expect(isSearchPage('https://onlinelibrary.wiley.com/action/doSearch?AllField=uhi', {})).toBe(
      true,
    );
    expect(isSearchPage('https://arxiv.org/list/physics.ao-ph/2301', {})).toBe(true);
  });

  it('never flags a page that declares bibliographic meta tags', () => {
    expect(isSearchPage(SCHOLAR_SERP, { citation_title: 'A real article' })).toBe(false);
    expect(isSearchPage('https://ex.org/search?q=x', { citation_doi: '10.1/x' })).toBe(false);
    expect(isSearchPage('https://ex.org/search?q=x', { 'dc.title': 'Titled' })).toBe(false);
  });

  it('leaves article-looking pages capturable', () => {
    expect(isSearchPage('https://www.mdpi.com/2072-4292/8/2/153', {})).toBe(false);
    expect(isSearchPage('https://arxiv.org/abs/1705.00504', {})).toBe(false);
    // A deep path with a stray ?q= is not a search page.
    expect(isSearchPage('https://ex.org/2020/article-slug?q=highlight', {})).toBe(false);
    expect(isSearchPage('not a url', {})).toBe(false);
  });
});

describe('toCslData', () => {
  it('produces CSL JSON with a DOI and URL', () => {
    const csl = toCslData(
      { title: 'T', authors: ['Oke, T. R.'], year: 1982, journal: 'QJRMS', doi: '10.1/x' },
      'https://example.org/a',
    );
    expect(csl['type']).toBe('article-journal');
    expect(csl['DOI']).toBe('10.1/x');
    expect(csl['URL']).toBe('https://example.org/a');
    expect(csl['issued']).toEqual({ 'date-parts': [[1982]] });
  });
});
