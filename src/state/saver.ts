import { deletePlan, upsertPlan } from "../db/plans";
import { saveSetting } from "../db/settings";
import { deleteTask, upsertTask } from "../db/tasks";
import type { Db } from "../db/types";
import type { Settings } from "../types";
import type { AppState } from "./appState";

type Entry = { kind: "task"; id: string } | { kind: "plan"; id: string } | { kind: "setting"; id: keyof Settings };

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "알 수 없는 오류";
}

/**
 * Write-behind persistence. Callers update the in-memory state first (instant UI),
 * then mark the changed entity dirty. A flush writes the *latest* snapshot of every
 * dirty entity (upsert if it exists, delete if it was removed), so repeated edits
 * coalesce into one write and writes can never be applied out of order.
 * Failed entries stay dirty and are retried on the next flush — nothing is dropped.
 */
export class Saver {
  private dirty = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private lastError: string | null = null;
  db: Db | null = null;

  constructor(
    private getState: () => AppState,
    private onError: (message: string | null) => void,
  ) {}

  /** `delayMs = 0` persists right away (next microtask); otherwise debounced. */
  mark(entry: Entry, delayMs = 0): void {
    this.dirty.set(`${entry.kind}:${entry.id}`, entry);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (delayMs <= 0) queueMicrotask(() => void this.flush());
    else this.timer = setTimeout(() => void this.flush(), delayMs);
  }

  get hasPending(): boolean {
    return this.dirty.size > 0 || this.running !== null;
  }

  /** Writes everything pending. Resolves `true` when all changes are on disk. */
  async flush(): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.running) await this.running;
    if (this.dirty.size === 0) return this.lastError === null;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    return this.dirty.size === 0 && this.lastError === null;
  }

  private async run(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const entries = [...this.dirty.values()];
    this.dirty.clear();

    const state = this.getState();
    const tasks = new Map(state.tasks.map((t) => [t.id, t]));
    const plans = new Map(state.plans.map((p) => [p.id, p]));
    // Order respects foreign keys: new plans → tasks → removed plans → settings.
    const rank = (e: Entry) =>
      e.kind === "plan" ? (plans.has(e.id) ? 0 : 2) : e.kind === "task" ? 1 : 3;
    entries.sort((a, b) => rank(a) - rank(b));

    let error: string | null = null;
    for (const e of entries) {
      try {
        if (e.kind === "task") {
          const t = tasks.get(e.id);
          if (t) {
            // A plan deleted meanwhile must not make the write fail.
            await upsertTask(db, t.planId && !plans.has(t.planId) ? { ...t, planId: null } : t);
          } else await deleteTask(db, e.id);
        } else if (e.kind === "plan") {
          const p = plans.get(e.id);
          if (p) await upsertPlan(db, p);
          else await deletePlan(db, e.id);
        } else {
          await saveSetting(db, e.id, state.settings[e.id]);
        }
      } catch (err) {
        error = errorMessage(err);
        const key = `${e.kind}:${e.id}`;
        if (!this.dirty.has(key)) this.dirty.set(key, e); // keep for retry
      }
    }
    if (error !== this.lastError) {
      this.lastError = error;
      this.onError(error);
    }
  }
}
