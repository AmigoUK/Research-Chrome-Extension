import { describe, it, expect } from 'vitest';
import { migrationVersionsToRun, DB_VERSION } from './schema';

describe('migrationVersionsToRun', () => {
  it('lists versions from a fresh (empty) database up to the target', () => {
    expect(migrationVersionsToRun(0, 1)).toEqual([1]);
    expect(migrationVersionsToRun(0, 3)).toEqual([1, 2, 3]);
  });

  it('lists only versions strictly greater than the current one', () => {
    expect(migrationVersionsToRun(2, 4)).toEqual([3, 4]);
  });

  it('returns nothing when already at the target version', () => {
    expect(migrationVersionsToRun(DB_VERSION, DB_VERSION)).toEqual([]);
  });
});
