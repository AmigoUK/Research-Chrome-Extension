import { describe, it, expect } from 'vitest';
import {
  createPdfAnchor,
  resolvePdfAnchor,
  anchorPage,
  anchorQuote,
  isRegionAnchor,
} from './pdf';

const BOX = { width: 700, height: 900 };

describe('createPdfAnchor', () => {
  it('stores rects as fractions of the page box, with the page number', () => {
    const anchor = createPdfAnchor(3, [{ left: 70, top: 90, width: 140, height: 45 }], BOX, 'hello');
    expect(anchor.kind).toBe('pdf');
    const sel = anchor.selectors[0]!;
    expect(sel.type).toBe('pdfRegion');
    expect(sel.page).toBe(3);
    expect(sel.quote).toBe('hello');
    expect(sel.rects[0]).toEqual({ page: 3, left: 0.1, top: 0.1, width: 0.2, height: 0.05 });
  });

  it('drops zero-area rects', () => {
    const anchor = createPdfAnchor(
      1,
      [
        { left: 10, top: 10, width: 0, height: 20 },
        { left: 10, top: 10, width: 20, height: 20 },
      ],
      BOX,
    );
    expect(anchor.selectors[0]!.rects).toHaveLength(1);
  });

  it('omits quote for a region anchor', () => {
    const anchor = createPdfAnchor(1, [{ left: 0, top: 0, width: 100, height: 100 }], BOX);
    expect(anchor.selectors[0]!.quote).toBeUndefined();
    expect(isRegionAnchor(anchor)).toBe(true);
  });
});

describe('resolvePdfAnchor', () => {
  it('round-trips px → fractions → px at the same box size', () => {
    const rects = [{ left: 70, top: 90, width: 140, height: 45 }];
    const anchor = createPdfAnchor(2, rects, BOX, 'q');
    const resolved = resolvePdfAnchor(anchor, BOX);
    expect(resolved[0]).toEqual({ page: 2, left: 70, top: 90, width: 140, height: 45 });
  });

  it('is zoom-invariant — resolving at 2× box scales pixels 2×', () => {
    const anchor = createPdfAnchor(1, [{ left: 70, top: 90, width: 140, height: 45 }], BOX);
    const doubled = resolvePdfAnchor(anchor, { width: 1400, height: 1800 });
    expect(doubled[0]).toEqual({ page: 1, left: 140, top: 180, width: 280, height: 90 });
  });
});

describe('anchor helpers', () => {
  it('reports page, quote and region-ness', () => {
    const text = createPdfAnchor(4, [{ left: 1, top: 1, width: 10, height: 10 }], BOX, 'quoted');
    const region = createPdfAnchor(5, [{ left: 1, top: 1, width: 10, height: 10 }], BOX);
    expect(anchorPage(text)).toBe(4);
    expect(anchorQuote(text)).toBe('quoted');
    expect(isRegionAnchor(text)).toBe(false);
    expect(anchorPage(region)).toBe(5);
    expect(anchorQuote(region)).toBeUndefined();
    expect(isRegionAnchor(region)).toBe(true);
  });
});
