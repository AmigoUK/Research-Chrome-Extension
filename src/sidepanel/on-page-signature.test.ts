import { describe, it, expect } from 'vitest';
import { onPageSignature } from './on-page-signature';
import type { Annotation, HighlightColor } from '../core/model/types';

const NOW = '2026-08-05T00:00:00.000Z';
const palette: HighlightColor[] = [{ id: 'c1', swatch: '#ffcc00', label: 'Evidence' }];
const base: Annotation = {
  id: 'a1',
  projectId: 'p1',
  documentId: 'd1',
  anchor: { kind: 'web', selectors: [{ type: 'textQuote', exact: 'q' }] },
  content: 'note',
  tags: [],
  status: 'draft',
  author: 'u1',
  createdAt: NOW,
  updatedAt: NOW,
};
const sig = (a: Annotation[], p = palette, r = new Set<string>()) => onPageSignature(a, p, r);

describe('onPageSignature', () => {
  // Table-driven on purpose: this defends every future field someone adds to
  // the card and forgets to fold in here. The failure mode is a control that
  // saves correctly and never redraws — it reads as a dead button.
  const changes: Array<[string, Partial<Annotation>]> = [
    ['content', { content: 'edited' }],
    ['status', { status: 'includedInReport' }],
    ['colour', { color: 'c1' }],
    ['section', { section: 's1' }],
  ];
  for (const [field, patch] of changes) {
    it(`changes when ${field} changes`, () => {
      expect(sig([{ ...base, ...patch }])).not.toBe(sig([base]));
    });
  }

  it('changes when a passage is added or removed', () => {
    expect(sig([base, { ...base, id: 'a2' }])).not.toBe(sig([base]));
  });

  it('changes when a passage stops being placed on the page', () => {
    expect(sig([base], palette, new Set(['a1']))).not.toBe(sig([base]));
  });

  it('changes when the palette label changes, because the card shows it', () => {
    expect(sig([base], [{ id: 'c1', swatch: '#ffcc00', label: 'Renamed' }])).not.toBe(sig([base]));
  });

  it('stays the same for an unchanged list, so typing does not trigger a repaint', () => {
    expect(sig([base])).toBe(sig([{ ...base }]));
  });
});
