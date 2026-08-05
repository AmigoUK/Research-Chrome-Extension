import { describe, it, expect } from 'vitest';
import { resolveOutline, DEFAULT_OUTLINE_TITLES } from './outline';
import type { Project } from '../model/types';

const base: Project = {
  id: 'p1',
  name: 'Essay',
  members: [],
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

describe('resolveOutline', () => {
  it('returns a stored outline unchanged', () => {
    const outline = [{ id: 's1', title: 'Intro' }];
    expect(resolveOutline({ ...base, outline })).toEqual(outline);
  });

  it('derives one section per legacy title, minting ids', () => {
    const out = resolveOutline({ ...base, sections: ['Literature', 'Methods'] });
    expect(out.map((s) => s.title)).toEqual(['Literature', 'Methods']);
    expect(new Set(out.map((s) => s.id)).size).toBe(2);
    expect(out.every((s) => s.id.length > 0)).toBe(true);
  });

  it('is stable across calls, so the screen and the export agree', () => {
    const project = { ...base, sections: ['Literature', 'Methods'] };
    expect(resolveOutline(project)).toEqual(resolveOutline(project));
  });

  it('falls back to the essay-shaped defaults when there is nothing to derive from', () => {
    expect(resolveOutline(base).map((s) => s.title)).toEqual([...DEFAULT_OUTLINE_TITLES]);
  });

  it('prefers a stored outline over legacy sections', () => {
    const outline = [{ id: 's1', title: 'Intro' }];
    expect(resolveOutline({ ...base, outline, sections: ['Literature'] })).toEqual(outline);
  });

  it('ignores an empty stored outline rather than showing no sections at all', () => {
    expect(resolveOutline({ ...base, outline: [] }).length).toBeGreaterThan(0);
  });
});
