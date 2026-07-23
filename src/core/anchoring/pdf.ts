/**
 * PDF anchoring: turn page-relative pixel rectangles into a durable
 * fraction-coordinate anchor and resolve it back to pixels for any page size.
 *
 * A PDF is fixed-layout, so an anchor is a page number plus rectangles stored as
 * fractions (0–1) of the page box — which makes them invariant to zoom and to
 * the DPR the page was rendered at. Mirrors the shape of `web.ts` (create /
 * resolve), but is pure math: no DOM, no pdf.js, no `chrome.*` — unit-testable.
 *
 * A text highlight carries the selected `quote`; a drawn region does not — this
 * is how the two are told apart (`isRegionAnchor`).
 */
import type { PdfAnchor, PdfRect } from '../model/types';

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PageBox {
  width: number;
  height: number;
}

/** Build a PDF anchor from pixel rects measured against a page box of `box` px. */
export function createPdfAnchor(
  page: number,
  rects: PxRect[],
  box: PageBox,
  quote?: string,
): PdfAnchor {
  const w = box.width || 1;
  const h = box.height || 1;
  const frac: PdfRect[] = rects
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      page,
      left: r.left / w,
      top: r.top / h,
      width: r.width / w,
      height: r.height / h,
    }));
  return {
    kind: 'pdf',
    selectors: [{ type: 'pdfRegion', page, rects: frac, ...(quote ? { quote } : {}) }],
  };
}

/** Resolve an anchor to pixel rects for a page rendered at `box` px. */
export function resolvePdfAnchor(anchor: PdfAnchor, box: PageBox): Array<PxRect & { page: number }> {
  const out: Array<PxRect & { page: number }> = [];
  for (const sel of anchor.selectors) {
    for (const r of sel.rects) {
      out.push({
        page: r.page,
        left: r.left * box.width,
        top: r.top * box.height,
        width: r.width * box.width,
        height: r.height * box.height,
      });
    }
  }
  return out;
}

/** The page an anchor points at (from its first selector). */
export function anchorPage(anchor: PdfAnchor): number {
  return anchor.selectors[0]?.page ?? 1;
}

/** The quoted text of a text-highlight anchor, if any. */
export function anchorQuote(anchor: PdfAnchor): string | undefined {
  return anchor.selectors.find((s) => s.quote)?.quote;
}

/** A region (drawn box) anchor carries no quote; a text highlight does. */
export function isRegionAnchor(anchor: PdfAnchor): boolean {
  return !anchor.selectors.some((s) => s.quote);
}
