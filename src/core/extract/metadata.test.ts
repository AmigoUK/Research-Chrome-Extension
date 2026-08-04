import { describe, it, expect } from 'vitest';
import {
  findDoi,
  buildDocumentMetadata,
  inferDocumentType,
  isSearchPage,
  parseAuthorName,
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

  // The tag set an APS / Physical Review-style page actually serves — the
  // volume/issue/pages were present on every publisher tested live and were
  // silently dropped, leaving bibliographies without them.
  it('captures volume, issue and a page range', () => {
    const meta = buildDocumentMetadata({
      metaTags: {
        citation_title: 'Role of City Texture in Urban Heat Islands at Nighttime',
        citation_journal_title: 'Physical Review Letters',
        citation_volume: '120',
        citation_issue: '10',
        citation_firstpage: '108701',
        citation_publication_date: '2018/03/09',
      },
    });
    expect(meta.volume).toBe('120');
    expect(meta.issue).toBe('10');
    expect(meta.pages).toBe('108701'); // article number: firstpage, no lastpage
  });

  it('joins first and last page into a range', () => {
    const meta = buildDocumentMetadata({
      metaTags: { citation_firstpage: '369', citation_lastpage: '375' },
    });
    expect(meta.pages).toBe('369–375');
  });

  it('does not mistake og:site_name for a journal — the arXiv trap', () => {
    const meta = buildDocumentMetadata({
      metaTags: {
        citation_title: 'Role of Structural Morphology in Urban Heat Islands',
        'og:site_name': 'arXiv.org',
        citation_arxiv_id: '1705.00504',
        citation_date: '2017/05/01',
      },
    });
    expect(meta.journal).toBeUndefined();
    expect(meta.identifiers).toEqual({ arxiv: '1705.00504' });
    expect(inferDocumentType(meta)).toBe('article');
  });

  it('recovers a year from the online-date fallbacks', () => {
    expect(buildDocumentMetadata({ metaTags: { citation_online_date: '2005-05-01' } }).year).toBe(
      2005,
    );
    expect(buildDocumentMetadata({ metaTags: { 'dc.date.issued': '2005' } }).year).toBe(2005);
  });
});

describe('parseAuthorName', () => {
  it('parses "Family, Given" and "Given Family" alike', () => {
    expect(parseAuthorName('Azevedo, Juliana Antunes')).toEqual({
      family: 'Azevedo',
      given: 'Juliana Antunes',
    });
    expect(parseAuthorName('Juliana Antunes Azevedo')).toEqual({
      family: 'Azevedo',
      given: 'Juliana Antunes',
    });
  });

  it('collapses stray whitespace — Taylor & Francis emits "M.  Tiangco"', () => {
    expect(parseAuthorName('M.  Tiangco')).toEqual({ family: 'Tiangco', given: 'M.' });
  });

  it('keeps organisations and single tokens literal', () => {
    expect(parseAuthorName('Department for Environment, Food & Rural Affairs')).toEqual({
      literal: 'Department for Environment, Food & Rural Affairs',
    });
    expect(parseAuthorName('Aristotle')).toEqual({ literal: 'Aristotle' });
  });
});

describe('author deduplication', () => {
  it('folds the same people arriving in both name orders — the MDPI double list', () => {
    // Live capture from mdpi.com served 6 entries for 3 people.
    const meta = buildDocumentMetadata({
      authors: [
        'Juliana Antunes Azevedo',
        'Lee Chapman',
        'Catherine L. Muller',
        'Azevedo, Juliana Antunes',
        'Chapman, Lee',
        'Muller, Catherine L.',
      ],
      metaTags: { citation_title: 'Quantifying the UHI' },
    });
    expect(meta.authors).toEqual(['Juliana Antunes Azevedo', 'Lee Chapman', 'Catherine L. Muller']);
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
    // Structured, not literal — literal names cannot be inverted, shortened
    // to a surname in-text, or sorted by family name.
    expect(csl['author']).toEqual([{ family: 'Oke', given: 'T. R.' }]);
  });

  it('carries volume, issue and pages into CSL', () => {
    const csl = toCslData(
      { title: 'T', journal: 'PRL', volume: '120', issue: '10', pages: '108701' },
      'https://example.org/a',
    );
    expect(csl['volume']).toBe('120');
    expect(csl['issue']).toBe('10');
    expect(csl['page']).toBe('108701');
  });

  it('types a journal-less arXiv record as a preprint, not a webpage', () => {
    const csl = toCslData(
      { title: 'T', identifiers: { arxiv: '1705.00504' } },
      'https://arxiv.org/abs/1705.00504',
    );
    expect(csl['type']).toBe('article');
    expect(csl['genre']).toBe('preprint');
    expect(csl['archive']).toBe('arXiv');
    expect(csl['container-title']).toBeUndefined();
  });
});
