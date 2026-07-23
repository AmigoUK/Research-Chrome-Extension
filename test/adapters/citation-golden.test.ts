import { describe, it, expect } from 'vitest';
import { CiteJsFormatter } from '../../src/adapters/citation/citejs';
import type { CslItem } from '../../src/core/ports/citation';

const formatter = new CiteJsFormatter();

const ITEMS: Record<'one' | 'three' | 'four', CslItem> = {
  one: {
    id: 'a',
    type: 'article-journal',
    title: 'The energetic basis of the urban heat island',
    author: [{ family: 'Oke', given: 'T. R.' }],
    issued: { 'date-parts': [[1982]] },
    'container-title': 'Quarterly Journal of the Royal Meteorological Society',
    volume: '108',
    issue: '455',
    page: '1-24',
    DOI: '10.1002/qj.49710845502',
  },
  three: {
    id: 'b',
    type: 'article-journal',
    title: 'Urban form and extreme heat events',
    author: [
      { family: 'Stone', given: 'B.' },
      { family: 'Hess', given: 'J. J.' },
      { family: 'Frumkin', given: 'H.' },
    ],
    issued: { 'date-parts': [[2010]] },
    'container-title': 'Environmental Health Perspectives',
    volume: '118',
    issue: '10',
    page: '1425-1428',
    DOI: '10.1289/ehp.0901879',
  },
  four: {
    id: 'c',
    type: 'article-journal',
    title: 'Mortality risk attributable to high and low ambient temperature',
    author: [
      { family: 'Gasparrini', given: 'A.' },
      { family: 'Guo', given: 'Y.' },
      { family: 'Hashizume', given: 'M.' },
      { family: 'Lavigne', given: 'E.' },
    ],
    issued: { 'date-parts': [[2015]] },
    'container-title': 'The Lancet',
    volume: '386',
    page: '369-375',
    DOI: '10.1016/S0140-6736(14)62114-0',
  },
};

// Golden bibliography output pinned from citeproc-js (citation-js) — regressions
// in the engine, locale, or vendored CSL will surface as diffs here.
const GOLDEN: Record<string, Record<'one' | 'three' | 'four', string>> = {
  apa: {
    one: 'Oke, T. R. (1982). The energetic basis of the urban heat island. Quarterly Journal of the Royal Meteorological Society, 108(455), 1–24. https://doi.org/10.1002/qj.49710845502',
    three:
      'Stone, B., Hess, J. J., & Frumkin, H. (2010). Urban form and extreme heat events. Environmental Health Perspectives, 118(10), 1425–1428. https://doi.org/10.1289/ehp.0901879',
    four: 'Gasparrini, A., Guo, Y., Hashizume, M., & Lavigne, E. (2015). Mortality risk attributable to high and low ambient temperature. The Lancet, 386, 369–375. https://doi.org/10.1016/S0140-6736(14)62114-0',
  },
  'chicago-author-date': {
    one: 'Oke, T. R. 1982. “The Energetic Basis of the Urban Heat Island.” Quarterly Journal of the Royal Meteorological Society 108 (455): 1–24. https://doi.org/10.1002/qj.49710845502.',
    three:
      'Stone, B., J. J. Hess, and H. Frumkin. 2010. “Urban Form and Extreme Heat Events.” Environmental Health Perspectives 118 (10): 1425–28. https://doi.org/10.1289/ehp.0901879.',
    four: 'Gasparrini, A., Y. Guo, M. Hashizume, and E. Lavigne. 2015. “Mortality Risk Attributable to High and Low Ambient Temperature.” The Lancet 386: 369–75. https://doi.org/10.1016/S0140-6736(14)62114-0.',
  },
  harvard1: {
    one: 'Oke, T.R. (1982) “The energetic basis of the urban heat island,” Quarterly Journal of the Royal Meteorological Society, 108(455), pp. 1–24. doi:10.1002/qj.49710845502.',
    three:
      'Stone, B., Hess, J.J. and Frumkin, H. (2010) “Urban form and extreme heat events,” Environmental Health Perspectives, 118(10), pp. 1425–1428. doi:10.1289/ehp.0901879.',
    four: 'Gasparrini, A. et al. (2015) “Mortality risk attributable to high and low ambient temperature,” The Lancet, 386, pp. 369–375. doi:10.1016/S0140-6736(14)62114-0.',
  },
  'modern-language-association': {
    one: 'Oke, T. R. “The Energetic Basis of the Urban Heat Island.” Quarterly Journal of the Royal Meteorological Society, vol. 108, no. 455, 1982, pp. 1–24, https://doi.org/10.1002/qj.49710845502.',
    three:
      'Stone, B., et al. “Urban Form and Extreme Heat Events.” Environmental Health Perspectives, vol. 118, no. 10, 2010, pp. 1425–28, https://doi.org/10.1289/ehp.0901879.',
    four: 'Gasparrini, A., et al. “Mortality Risk Attributable to High and Low Ambient Temperature.” The Lancet, vol. 386, 2015, pp. 369–75, https://doi.org/10.1016/S0140-6736(14)62114-0.',
  },
};

describe('citation golden output (4 base styles × author counts)', () => {
  for (const [template, cases] of Object.entries(GOLDEN)) {
    for (const count of ['one', 'three', 'four'] as const) {
      it(`${template} — ${count} author(s)`, () => {
        expect(formatter.bibliography([ITEMS[count]], template)).toBe(cases[count]);
      });
    }
  }

  it('renders an in-text citation', () => {
    const inText = formatter.inText([ITEMS.one], 'apa');
    expect(inText).toContain('Oke');
    expect(inText).toContain('1982');
  });
});
