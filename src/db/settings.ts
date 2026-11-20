import { DEFAULT_SETTINGS, type Settings } from "../types";
import type { Db } from "./types";

const ALLOWED: { [K in keyof Settings]: readonly Settings[K][] } = {
  theme: ["system", "light", "dark"],
  alwaysOnTop: [true, false],
  view: ["todo", "plans"],
  filter: ["all", "today", "upcoming", "completed"],
  sort: ["manual", "due", "priority"],
};

/** Unknown keys and invalid values fall back to defaults. */
export async function loadSettings(db: Db): Promise<Settings> {
  const rows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM settings");
  const result: Settings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!(key in ALLOWED)) continue;
    const k = key as keyof Settings;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      continue;
    }
    if ((ALLOWED[k] as readonly unknown[]).includes(parsed)) {
      (result as unknown as Record<string, unknown>)[k] = parsed;
    }
  }
  return result;
}

export async function saveSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): Promise<void> {
  await db.execute(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(value)],
  );
}
