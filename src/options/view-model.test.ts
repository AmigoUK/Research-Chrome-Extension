import { describe, it, expect } from 'vitest';
import { DOCUMENT_STATUSES } from '../core/model/workflow';
import {
  NAV_ROUTES,
  ROUTES,
  ROUTE_TITLES,
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
    expect(NAV_ROUTES).toEqual(['overview', 'documents', 'annotations', 'references', 'styles']);
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
    expect(isRoute('members')).toBe(false); // Team is deferred, not a route
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
