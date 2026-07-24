import { describe, it, expect } from 'vitest';
import { DOCUMENT_STATUSES } from '../core/model/workflow';
import type { ActivityEvent } from '../core/model/types';
import {
  NAV_ROUTES,
  ROUTES,
  ROUTE_TITLES,
  activityFilterKinds,
  diffLabel,
  escapeHtml,
  groupActivityByDay,
  highlightEntity,
  isRoute,
  isNavRoute,
  isFullScreenRoute,
  statusDot,
  STATUS_DOT,
  sourceCountLabel,
  projectShortName,
} from './view-model';

describe('dashboard view-model', () => {
  it('lists the nav routes in nav order', () => {
    expect(NAV_ROUTES).toEqual([
      'overview',
      'documents',
      'annotations',
      'references',
      'styles',
      'team',
    ]);
  });

  it('has a title + subtitle for every route', () => {
    for (const route of ROUTES) {
      const [title, sub] = ROUTE_TITLES[route];
      expect(title.length).toBeGreaterThan(0);
      expect(sub.length).toBeGreaterThan(0);
    }
  });

  it('narrows valid routes and rejects unknown ones', () => {
    expect(isRoute('overview')).toBe(true);
    expect(isRoute('members')).toBe(false); // a tab inside Team, not a route
    expect(isRoute('')).toBe(false);
  });

  it('keeps the style editor out of the nav but reachable as a route', () => {
    expect(isRoute('styleEditor')).toBe(true);
    expect(isNavRoute('styleEditor')).toBe(false);
    expect(isFullScreenRoute('styleEditor')).toBe(true);
    expect(isFullScreenRoute('styles')).toBe(false);
  });

  it('maps every document status to a css colour variable', () => {
    for (const status of DOCUMENT_STATUSES) {
      expect(statusDot(status)).toBe(STATUS_DOT[status]);
      expect(statusDot(status)).toMatch(/^var\(--s-/);
    }
  });

  it('formats the source-count label', () => {
    expect(sourceCountLabel(0)).toBe('0 src');
    expect(sourceCountLabel(5)).toBe('5 src');
  });

  it('takes the leading token as a short project name', () => {
    expect(projectShortName('Urban Heat & Mortality')).toBe('Urban');
    expect(projectShortName('FOI — Air Quality')).toBe('FOI');
    expect(projectShortName('Misinformation')).toBe('Misinformation');
  });
});

describe('activity feed view-model', () => {
  // Local-time construction keeps the day boundaries timezone-independent.
  const at = (y: number, m: number, d: number, h = 12, min = 0): string =>
    new Date(y, m - 1, d, h, min).toISOString();

  function event(over: Partial<ActivityEvent> & { createdAt: string }): ActivityEvent {
    return {
      id: 'e1',
      projectId: 'p1',
      actorUserId: 'me',
      kind: 'status',
      summary: 'moved a source',
      ...over,
    };
  }

  it('groups events into Today / Yesterday / dated sections, newest first', () => {
    const now = at(2026, 7, 24, 18);
    const days = groupActivityByDay(
      [
        event({ id: 'a', createdAt: at(2026, 7, 24, 14, 32) }),
        event({ id: 'b', createdAt: at(2026, 7, 24, 9, 5) }),
        event({ id: 'c', createdAt: at(2026, 7, 23, 17) }),
        event({ id: 'd', createdAt: at(2026, 7, 21, 8) }),
      ],
      now,
    );

    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday', '21 Jul 2026']);
    expect(days[0]?.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(days[2]?.events).toHaveLength(1);
  });

  it('returns no sections for an empty feed', () => {
    expect(groupActivityByDay([], at(2026, 7, 24))).toEqual([]);
  });

  it('labels raw diff values per kind and passes unknown ones through', () => {
    expect(diffLabel('status', 'inReview')).toBe('In review');
    expect(diffLabel('member', 'viewer')).toBe('Viewer');
    expect(diffLabel('annotation', 'draft')).toBe('draft');
  });

  it('emphasises the entity only after escaping the summary', () => {
    expect(highlightEntity('added Oke 1982', 'Oke 1982')).toBe(
      'added <span class="ent">Oke 1982</span>',
    );
    expect(highlightEntity('added <b>x</b>', '<b>x</b>')).toBe(
      'added <span class="ent">&lt;b&gt;x&lt;/b&gt;</span>',
    );
    expect(highlightEntity('added a source')).toBe('added a source');
    // An entity that is not in the summary leaves the text untouched.
    expect(highlightEntity('added a source', 'Oke 1982')).toBe('added a source');
  });

  it('escapes the characters that could break out of an attribute or tag', () => {
    expect(escapeHtml('a & b <i> "q"')).toBe('a &amp; b &lt;i&gt; &quot;q&quot;');
  });

  it('offers filter chips only for the kinds present, in canonical order', () => {
    const kinds = activityFilterKinds([
      event({ createdAt: at(2026, 7, 24), kind: 'member' }),
      event({ createdAt: at(2026, 7, 24), kind: 'source' }),
      event({ createdAt: at(2026, 7, 24), kind: 'member' }),
    ]);
    expect(kinds).toEqual(['source', 'member']);
    expect(activityFilterKinds([])).toEqual([]);
  });
});
