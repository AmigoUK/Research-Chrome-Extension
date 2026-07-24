/**
 * Database opener. Wires the versioned migrations into idb's `upgrade` hook.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, runMigrations, type ContextNotesDB } from './schema';

export type ContextNotesDatabase = IDBPDatabase<ContextNotesDB>;

export function openContextNotesDB(
  name: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<ContextNotesDatabase> {
  return openDB<ContextNotesDB>(name, version, {
    upgrade(db, oldVersion, newVersion, tx) {
      runMigrations(db, oldVersion, newVersion ?? DB_VERSION, tx);
    },
    /** An upgrade is waiting on a connection that some other context still holds. */
    blocked(currentVersion, blockedVersion) {
      console.warn(
        `[context-notes] database upgrade ${currentVersion} → ${blockedVersion ?? DB_VERSION} is ` +
          'blocked by another open connection; close other extension pages',
      );
    },
    /** Somewhere else wants to upgrade; let go so it can, rather than deadlock. */
    blocking(currentVersion, blockedVersion, event) {
      console.warn(
        `[context-notes] closing this connection (v${currentVersion}) so an upgrade to ` +
          `v${blockedVersion ?? DB_VERSION} can proceed`,
      );
      (event.target as IDBDatabase | null)?.close();
    },
  });
}
