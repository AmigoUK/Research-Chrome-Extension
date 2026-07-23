import { describe, it, expect } from 'vitest';
import {
  filterDocuments,
  groupByStatus,
  statusCounts,
  computeProgress,
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
