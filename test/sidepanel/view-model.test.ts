import { describe, it, expect } from 'vitest';
import {
  filterDocuments,
  groupByStatus,
  statusCounts,
  computeProgress,
  gettingStartedSteps,
  gettingStartedComplete,
} from '../../src/sidepanel/view-model';
import type { Document } from '../../src/core/model/types';
import type { DocumentStatus } from '../../src/core/model/workflow';

const NOW = '2026-07-23T00:00:00.000Z';

function doc(id: string, status: DocumentStatus, title: string, doi?: string): Document {
  return {
    id,
    projectId: 'p1',
    url: `https://example.org/${id}`,
    type: 'article',
    metadata: { title, ...(doi ? { doi } : {}) },
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const docs: Document[] = [
  doc('d1', 'toRead', 'Urban heat island'),
  doc('d2', 'analysed', 'Mortality and temperature', '10.1/lancet'),
  doc('d3', 'analysed', 'Nocturnal cooling'),
  doc('d4', 'usedInOutput', 'Local background climate'),
];

describe('filterDocuments', () => {
  it('filters by status', () => {
    expect(filterDocuments(docs, { search: '', status: 'analysed' })).toHaveLength(2);
  });
  it('filters by free-text search across title and DOI', () => {
    expect(filterDocuments(docs, { search: 'mortality', status: 'all' })).toHaveLength(1);
    expect(filterDocuments(docs, { search: '10.1/lancet', status: 'all' })[0]?.id).toBe('d2');
  });
});

describe('groupByStatus', () => {
  it('groups in pipeline order and drops empty groups', () => {
    const groups = groupByStatus(docs);
    expect(groups.map((g) => g.status)).toEqual(['toRead', 'analysed', 'usedInOutput']);
    expect(groups.find((g) => g.status === 'analysed')?.documents).toHaveLength(2);
  });
});

describe('statusCounts', () => {
  it('counts per status plus all', () => {
    const c = statusCounts(docs);
    expect(c.all).toBe(4);
    expect(c.analysed).toBe(2);
    expect(c.inReview).toBe(0);
  });
});

describe('computeProgress', () => {
  it('counts analysed + usedInOutput as reviewed', () => {
    expect(computeProgress(docs)).toEqual({ total: 4, reviewed: 3, percent: 75 });
  });
  it('handles an empty list', () => {
    expect(computeProgress([])).toEqual({ total: 0, reviewed: 0, percent: 0 });
  });
});

describe('gettingStartedSteps', () => {
  const fresh = {
    hasCapturablePage: false,
    documentCount: 0,
    annotationCount: 0,
    movedBeyondToRead: false,
    hasSectionedAnnotation: false,
    copiedCitation: false,
  };

  it('starts with everything undone on a fresh install', () => {
    const steps = gettingStartedSteps(fresh);
    expect(steps).toHaveLength(6);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(gettingStartedComplete(steps)).toBe(false);
  });

  it('checks steps off from real data, not user claims', () => {
    const steps = gettingStartedSteps({
      hasCapturablePage: true,
      documentCount: 2,
      annotationCount: 1,
      movedBeyondToRead: false,
      hasSectionedAnnotation: false,
      copiedCitation: false,
    });
    const byId = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    expect(byId).toEqual({
      open: true,
      file: true,
      annotate: true,
      status: false,
      outline: false,
      cite: false,
    });
  });

  it('treats a filed project as proof the user has opened an article before', () => {
    // The panel may sit on a new tab; a non-empty project still means step 1
    // was done once — the checklist must not un-check history.
    const steps = gettingStartedSteps({ ...fresh, documentCount: 1 });
    expect(steps.find((s) => s.id === 'open')?.done).toBe(true);
  });

  it('checks off the outline step only once a passage has a section, not merely once one exists', () => {
    // Mirrors the annotate/status distinction above: having passages is not
    // the same as having arranged one of them.
    const steps = gettingStartedSteps({
      ...fresh,
      annotationCount: 3,
      hasSectionedAnnotation: false,
    });
    expect(steps.find((s) => s.id === 'outline')?.done).toBe(false);

    const arranged = gettingStartedSteps({
      ...fresh,
      annotationCount: 3,
      hasSectionedAnnotation: true,
    });
    expect(arranged.find((s) => s.id === 'outline')?.done).toBe(true);
  });

  it('reports complete only when every step is done', () => {
    const steps = gettingStartedSteps({
      hasCapturablePage: true,
      documentCount: 1,
      annotationCount: 1,
      movedBeyondToRead: true,
      hasSectionedAnnotation: true,
      copiedCitation: true,
    });
    expect(gettingStartedComplete(steps)).toBe(true);
  });
});
