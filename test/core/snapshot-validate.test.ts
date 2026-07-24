import { describe, it, expect } from 'vitest';
import { ID_PATTERN, validateSnapshotData } from '../../src/core/snapshot/validate';

const NOW = '2026-07-24T12:00:00.000Z';

/** A snapshot that should sail through, so the rejections below mean something. */
function good(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project: {
      id: 'p1',
      name: 'Urban Heat',
      sections: ['Literature'],
      members: [{ userId: 'me', role: 'owner' }],
      createdAt: NOW,
      updatedAt: NOW,
    },
    documents: [
      {
        id: 'd1',
        projectId: 'p1',
        url: 'https://example.org/d1',
        type: 'article',
        metadata: { title: 'A paper' },
        status: 'toRead',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    annotations: [],
    references: [],
    citationStyles: [],
    users: [],
    activity: [],
    commentThreads: [],
    ...over,
  };
}

/** Swap one field of the first document. */
function withDocument(patch: Record<string, unknown>): Record<string, unknown> {
  const data = good();
  const [doc] = data['documents'] as Array<Record<string, unknown>>;
  return good({ documents: [{ ...doc, ...patch }] });
}

describe('a well-formed snapshot', () => {
  it('passes and comes back as a fresh object', () => {
    const parsed = validateSnapshotData(good());
    expect(parsed.project.name).toBe('Urban Heat');
    expect(parsed.documents).toHaveLength(1);
  });

  it('accepts the id shapes this extension actually produces', () => {
    for (const value of [
      crypto.randomUUID(),
      'me',
      'custom-base:nature-author-date',
      'l.reyes@lab.edu',
      'e2e-doc-1',
    ]) {
      expect(ID_PATTERN.test(value), value).toBe(true);
    }
  });
});

describe('ids that would escape their attribute', () => {
  it('refuses an id carrying markup — the injection this whole file exists for', () => {
    expect(() => validateSnapshotData(withDocument({ id: 'x"><img src=1 id=pwned>' }))).toThrow(
      /source 1's id is not a usable id/,
    );
  });

  it('refuses ids that would break a CSS selector or an attribute quote', () => {
    for (const hostile of ['a"b', "a'b", 'a b', 'a[b]', 'a\\b', 'a<b', '']) {
      expect(() => validateSnapshotData(withDocument({ id: hostile })), hostile).toThrow(
        /not a usable id/,
      );
    }
  });

  it('refuses an over-long id rather than storing it', () => {
    expect(() => validateSnapshotData(withDocument({ id: 'a'.repeat(129) }))).toThrow(
      /not a usable id/,
    );
  });

  it('checks every id on the record, not just the primary one', () => {
    expect(() => validateSnapshotData(withDocument({ projectId: 'p"1' }))).toThrow(
      /source 1's project id/,
    );
    expect(() => validateSnapshotData(withDocument({ fileId: 'f"1' }))).toThrow(/source 1's file id/);
  });
});

describe('values that would corrupt behaviour rather than markup', () => {
  it('refuses a status outside the pipeline, which would hide the source from every column', () => {
    expect(() => validateSnapshotData(withDocument({ status: 'archived' }))).toThrow(
      /source 1's status is not one of/,
    );
  });

  it('refuses a role outside the matrix', () => {
    const data = good();
    (data['project'] as Record<string, unknown>)['members'] = [{ userId: 'me', role: 'admin' }];
    expect(() => validateSnapshotData(data)).toThrow(/member 1's role is not one of/);
  });

  it('refuses an activity kind the feed cannot render', () => {
    const data = good({
      activity: [
        { id: 'e1', projectId: 'p1', actorUserId: 'me', kind: 'explosion', summary: 'x', createdAt: NOW },
      ],
    });
    expect(() => validateSnapshotData(data)).toThrow(/history entry 1's kind/);
  });

  it('refuses file contents that are not base64', () => {
    const data = good({
      files: [{ id: 'f1', name: 'a.pdf', mime: 'application/pdf', dataBase64: 'not base64!', createdAt: NOW }],
    });
    expect(() => validateSnapshotData(data)).toThrow(/file 1's contents are not base64/);
  });
});

describe('timestamps', () => {
  it('normalises an offset date to UTC, so the newest record really wins the merge', () => {
    // 12:00+02:00 is 10:00Z — earlier than 11:00Z, though the string sorts later.
    const parsed = validateSnapshotData(withDocument({ updatedAt: '2026-07-24T12:00:00+02:00' }));
    const updatedAt = parsed.documents[0]?.updatedAt ?? '';
    expect(updatedAt).toBe('2026-07-24T10:00:00.000Z');
    expect(updatedAt < '2026-07-24T11:00:00.000Z').toBe(true);
  });

  it('refuses something that is not a date at all', () => {
    expect(() => validateSnapshotData(withDocument({ updatedAt: 'last tuesday' }))).toThrow(
      /is not a date/,
    );
  });
});

describe('shape', () => {
  it('names what is wrong rather than failing vaguely', () => {
    expect(() => validateSnapshotData(null)).toThrow(/the snapshot is not a record/);
    expect(() => validateSnapshotData({})).toThrow(/the project is not a record/);
    expect(() => validateSnapshotData(good({ documents: 'nope' }))).toThrow(
      /the document list is not a list/,
    );
  });

  it('treats a missing collection as empty, so an older snapshot still imports', () => {
    const data = good();
    delete data['commentThreads'];
    delete data['activity'];
    expect(validateSnapshotData(data).commentThreads).toEqual([]);
  });
});
