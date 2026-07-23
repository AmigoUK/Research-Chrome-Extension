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
  });
}
