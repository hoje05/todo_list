/**
 * Minimal database surface used by the repositories. `@tauri-apps/plugin-sql`'s
 * `Database` satisfies it in the app; tests use an in-memory SQLite adapter.
 * Placeholders are positional `$1, $2, ...` and values are always bound.
 */
export interface Db {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}
