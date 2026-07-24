/**
 * Sample CSL-JSON records used by the citation-style previews. They cover the
 * source types this project actually cites — journal articles (one and many
 * authors), datasets, FOI requests and legal cases — so a rule change is
 * visible where it matters. Pure data + a pure mapper, no DOM.
 */
export interface PreviewSample {
  /** CSL type, shown as the chip on the preview card. */
  type: string;
  /** Human label for the card. */
  label: string;
  item: Record<string, unknown>;
}

export const PREVIEW_SAMPLES: readonly PreviewSample[] = [
  {
    type: 'article',
    label: 'Journal article · 4 authors',
    item: {
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
      issue: '9991',
      page: '369-375',
      DOI: '10.1016/S0140-6736(14)62114-0',
    },
  },
  {
    type: 'article',
    label: 'Journal article · 1 author',
    item: {
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
  },
  {
    type: 'dataset',
    label: 'Dataset · no DOI',
    item: {
      type: 'dataset',
      title: 'UK-AIR: Air Quality Data Archive',
      author: [{ literal: 'Department for Environment, Food & Rural Affairs' }],
      issued: { 'date-parts': [[2024]] },
      publisher: 'Defra',
      URL: 'https://uk-air.defra.gov.uk',
    },
  },
  {
    type: 'foi',
    label: 'FOI request',
    item: {
      type: 'report',
      title: 'Automatic monitoring station metadata',
      authority: 'Environment Agency',
      number: 'EA/2023/0456',
      issued: { 'date-parts': [[2023, 5, 12]] },
    },
  },
  {
    type: 'legal',
    label: 'Legal case',
    item: {
      type: 'legal_case',
      title: 'R (ClientEarth) v Secretary of State',
      authority: 'High Court',
      number: '[2021] EWHC 1234 (Admin)',
      'container-title': 'EWHC',
      issued: { 'date-parts': [[2021]] },
    },
  },
];

/** CSL-JSON items for `citations/preview`, each with the id citeproc needs. */
export function previewItems(): Array<Record<string, unknown>> {
  return PREVIEW_SAMPLES.map((sample, i) => ({ ...sample.item, id: `preview-${i}` }));
}
