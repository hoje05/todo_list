// Test-only adapter: runs the real migration SQL on Node's built-in SQLite.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "./types";

const MIGRATION = readFileSync(new URL("../../src-tauri/migrations/001_init.sql", import.meta.url), "utf8");

function named(params: unknown[] = []) {
  const out: Record<string, null | number | string> = {};
  params.forEach((v, i) => {
    out[`$${i + 1}`] = v === undefined ? null : (v as null | number | string);
  });
  return out;
}

export interface TestDb extends Db {
  raw: DatabaseSync;
  /** When set, every `execute` throws this error (simulates disk full / locked DB). */
  failWrites: Error | null;
}

export function createTestDb(path = ":memory:"): TestDb {
  const raw = new DatabaseSync(path);
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(MIGRATION);
  const db: TestDb = {
    raw,
    failWrites: null,
    async execute(sql, params) {
      if (db.failWrites) throw db.failWrites;
      raw.prepare(sql).run(named(params));
      return undefined;
    },
    async select<T>(sql: string, params?: unknown[]) {
      return raw.prepare(sql).all(named(params)) as T;
    },
  };
  return db;
}
