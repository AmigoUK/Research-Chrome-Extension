/**
 * IndexedDB schema and migrations.
 *
 * The schema is versioned; each migration takes the database from version
 * N-1 to N inside the `onupgradeneeded` transaction. Adding a store or index
 * later means bumping `DB_VERSION` and appending a migration — never editing
 * a shipped one.
 */
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type {
  Project,
  Document,
  Annotation,
  Reference,
  CitationStyle,
  User,
} from '../../core/model/types';

export const DB_NAME = 'context-notes';
export const DB_VERSION = 1;

export interface ContextNotesDB extends DBSchema {
  projects: { key: string; value: Project };
  documents: {
    key: string;
    value: Document;
    indexes: { byProject: string; byProjectDoi: [string, string] };
  };
  annotations: {
    key: string;
    value: Annotation;
    indexes: { byProject: string; byDocument: string };
  };
  references: {
    key: string;
    value: Reference;
    indexes: { byProject: string; byDocument: string };
  };
  citationStyles: { key: string; value: CitationStyle };
  users: { key: string; value: User };
}

type UpgradeTx = IDBPTransaction<
  ContextNotesDB,
  ArrayLike<StoreNames<ContextNotesDB>>,
  'versionchange'
>;

/**
 * Migrations keyed by the version they produce. `migrations[1]` upgrades an
 * empty database (version 0) to version 1.
 */
export const migrations: Record<number, (db: IDBPDatabase<ContextNotesDB>, tx: UpgradeTx) => void> =
  {
    1(db) {
      db.createObjectStore('projects', { keyPath: 'id' });

      const documents = db.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('byProject', 'projectId');
      documents.createIndex('byProjectDoi', ['projectId', 'metadata.doi']);

      const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
      annotations.createIndex('byProject', 'projectId');
      annotations.createIndex('byDocument', 'documentId');

      const references = db.createObjectStore('references', { keyPath: 'id' });
      references.createIndex('byProject', 'projectId');
      references.createIndex('byDocument', 'documentId');

      db.createObjectStore('citationStyles', { keyPath: 'id' });
      db.createObjectStore('users', { keyPath: 'id' });
    },
  };

/** The migration versions to apply, in order, for an upgrade. */
export function migrationVersionsToRun(oldVersion: number, newVersion: number): number[] {
  const versions: number[] = [];
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    versions.push(v);
  }
  return versions;
}

/** Run every migration strictly greater than `oldVersion`, in order. */
export function runMigrations(
  db: IDBPDatabase<ContextNotesDB>,
  oldVersion: number,
  newVersion: number,
  tx: UpgradeTx,
): void {
  for (const v of migrationVersionsToRun(oldVersion, newVersion)) {
    migrations[v]?.(db, tx);
  }
}
