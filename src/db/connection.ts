import Database from "@tauri-apps/plugin-sql";
import type { Db } from "./types";

/** Must match `DB_URL` in src-tauri/src/lib.rs (migrations are registered there). */
const DB_URL = "sqlite:desktodo.db";

let pending: Promise<Db> | null = null;

/**
 * Opens (and on first run creates + migrates) the database in the OS app config
 * directory, e.g. `%APPDATA%\com.desktodo.app\desktodo.db` on Windows.
 */
export function openDatabase(): Promise<Db> {
  pending ??= (async () => {
    const db = await Database.load(DB_URL);
    try {
      // WAL: readers never block the writer and commits are cheap. Persistent per file.
      await db.select("PRAGMA journal_mode = WAL");
    } catch (e) {
      console.warn("WAL mode unavailable", e);
    }
    return db;
  })().catch((e: unknown) => {
    pending = null; // allow retry
    throw e;
  });
  return pending;
}
