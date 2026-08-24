import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

let instance: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (instance) return instance;
  const file = config.dbFile;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });

  instance = new DatabaseSync(file);
  instance.exec('PRAGMA journal_mode = WAL;');
  instance.exec('PRAGMA foreign_keys = ON;');
  instance.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return instance;
}

export function resetForTests(): DatabaseSync {
  instance?.close();
  instance = null;
  return db();
}

type Row = Record<string, any>;

export const all = <T = Row>(sql: string, params: any[] = []): T[] =>
  db().prepare(sql).all(...params) as T[];

export const get = <T = Row>(sql: string, params: any[] = []): T | undefined =>
  db().prepare(sql).get(...params) as T | undefined;

export const run = (sql: string, params: any[] = []) => db().prepare(sql).run(...params);

/** Synchronous transaction helper — node:sqlite has no built-in wrapper. */
export function tx<T>(fn: () => T): T {
  const handle = db();
  handle.exec('BEGIN');
  try {
    const result = fn();
    handle.exec('COMMIT');
    return result;
  } catch (error) {
    handle.exec('ROLLBACK');
    throw error;
  }
}

/** Next value for a per-prefix business reference counter. */
export function nextSequence(table: string, column = 'reference'): number {
  const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return (row?.n ?? 0) + 1;
}
