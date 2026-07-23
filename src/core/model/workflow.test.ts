import { describe, it, expect } from 'vitest';
import { DOCUMENT_STATUSES, isReviewed, nextStatus } from './workflow';

describe('workflow statuses', () => {
  it('defines the pipeline in order', () => {
    expect(DOCUMENT_STATUSES).toEqual(['toRead', 'inReview', 'analysed', 'usedInOutput']);
  });

  it('marks analysed and usedInOutput as reviewed', () => {
    expect(isReviewed('toRead')).toBe(false);
    expect(isReviewed('inReview')).toBe(false);
    expect(isReviewed('analysed')).toBe(true);
    expect(isReviewed('usedInOutput')).toBe(true);
  });

  it('advances through the pipeline and clamps at the end', () => {
    expect(nextStatus('toRead')).toBe('inReview');
    expect(nextStatus('inReview')).toBe('analysed');
    expect(nextStatus('analysed')).toBe('usedInOutput');
    expect(nextStatus('usedInOutput')).toBe('usedInOutput');
  });
});
