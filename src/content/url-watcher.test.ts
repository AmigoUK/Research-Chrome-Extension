import { describe, it, expect } from 'vitest';
import { createUrlWatcher } from './url-watcher';

describe('createUrlWatcher', () => {
  it('does not fire on a check while the URL is unchanged', () => {
    const url = 'https://ex.com/a';
    const seen: string[] = [];
    const w = createUrlWatcher(
      () => url,
      (u) => seen.push(u),
    );
    w.check();
    w.check();
    expect(seen).toEqual([]);
  });

  it('fires once with the new URL when it changes', () => {
    let url = 'https://ex.com/a';
    const seen: string[] = [];
    const w = createUrlWatcher(
      () => url,
      (u) => seen.push(u),
    );
    url = 'https://ex.com/b';
    w.check();
    expect(seen).toEqual(['https://ex.com/b']);
  });

  it('does not fire again on repeated checks at the same URL', () => {
    let url = 'https://ex.com/a';
    const seen: string[] = [];
    const w = createUrlWatcher(
      () => url,
      (u) => seen.push(u),
    );
    url = 'https://ex.com/b';
    w.check();
    w.check();
    w.check();
    expect(seen).toEqual(['https://ex.com/b']);
  });

  it('fires for each distinct change, including navigating back', () => {
    let url = 'https://ex.com/a';
    const seen: string[] = [];
    const w = createUrlWatcher(
      () => url,
      (u) => seen.push(u),
    );
    url = 'https://ex.com/b';
    w.check();
    url = 'https://ex.com/a';
    w.check();
    expect(seen).toEqual(['https://ex.com/b', 'https://ex.com/a']);
  });
});
