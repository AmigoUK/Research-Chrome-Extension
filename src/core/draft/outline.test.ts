import { describe, it, expect } from 'vitest';
import { resolveOutline, DEFAULT_OUTLINE_TITLES } from './outline';
import { ID_PATTERN } from '../snapshot/validate';
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
    // Two distinct objects with the same content, not one object called
    // twice: a resolver that memoised a random id per object identity would
    // still pass the old two-calls-on-one-reference version of this test.
    const projectA = { ...base, sections: ['Literature', 'Methods'] };
    const projectB = { ...base, sections: ['Literature', 'Methods'] };
    const out = resolveOutline(projectA);
    expect(out[0]?.id).toBe('sec-0-literature');
    expect(resolveOutline(projectB)).toEqual(out);
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

  it('caps a long legacy title so its derived id stays inside the id grammar the importer enforces', () => {
    const out = resolveOutline({ ...base, sections: ['A'.repeat(128)] });
    expect(out[0]?.id.length).toBeLessThanOrEqual(128);
    expect(ID_PATTERN.test(out[0]?.id ?? '')).toBe(true);
  });

  it('returns entries the caller can reorder without mutating the stored outline', () => {
    const outline = [
      { id: 's1', title: 'Intro' },
      { id: 's2', title: 'Body' },
    ];
    const project = { ...base, outline };
    const out = resolveOutline(project);
    out.reverse();
    expect(project.outline?.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
