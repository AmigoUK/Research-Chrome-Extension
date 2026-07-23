import { describe, it, expect } from 'vitest';
import { findDoi, buildDocumentMetadata, inferDocumentType, toCslData } from './metadata';

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
