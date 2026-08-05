import { describe, it, expect } from 'vitest';
import { draftFilename } from './export-draft';

describe('draftFilename', () => {
  it('is readable and dated', () => {
    expect(draftFilename('My Research', '2026-08-05')).toBe('draft-my-research-2026-08-05.md');
  });

  it('strips characters a file system will not take', () => {
    expect(draftFilename('A/B: "C"?', '2026-08-05')).toBe('draft-a-b-c-2026-08-05.md');
  });

  it('still produces a name when the project name has nothing usable', () => {
    expect(draftFilename('///', '2026-08-05')).toBe('draft-2026-08-05.md');
  });
});
