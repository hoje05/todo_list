import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../db/testDb";
import { selectVisibleTasks } from "../lib/taskLogic";
import { TEXT_DEBOUNCE_MS, createApp } from "./actions";

let dbPath: string;
let db: TestDb;

async function boot(path = dbPath) {
  db = createTestDb(path);
  const app = createApp(async () => db);
  await app.actions.init();
  return app;
}

/** Simulates quitting and relaunching the program on the same database file. */
async function restart() {
  db.raw.close();
  return boot();
}

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), "desktodo-")), "test.db");
});

afterEach(() => {
  vi.useRealTimers();
  try {
    db.raw.close();
  } catch {
    /* already closed */
  }
});

describe("database bootstrap", () => {
  it("initializes an empty database with defaults", async () => {
    const { store } = await boot();
    const s = store.get();
    expect(s.phase).toBe("ready");
    expect(s.tasks).toEqual([]);
    expect(s.settings.theme).toBe("system");
  });

  it("migration is idempotent (re-running on an existing file keeps data)", async () => {
    const { actions } = await boot();
    actions.addTask("영어 공부 30분");
    await actions.flush();
    const again = await restart(); // createTestDb re-runs the migration SQL
    expect(again.store.get().tasks.map((t) => t.title)).toEqual(["영어 공부 30분"]);
  });

  it("reports a load error instead of crashing", async () => {
    const app = createApp(async () => {
      throw new Error("disk unavailable");
    });
    await app.actions.init();
    expect(app.store.get().phase).toBe("error");
    expect(app.store.get().loadError).toBe("disk unavailable");
  });

  it("schema rejects empty titles even if validation were bypassed", () => {
    db = createTestDb();
    expect(() =>
      db.raw.exec("INSERT INTO tasks (id,title,sort_order,created_at,updated_at) VALUES ('x','  ',0,0,0)"),
    ).toThrow();
  });
});

describe("tasks", () => {
  it("creates, completes, restores, edits and deletes with persistence", async () => {
    let app = await boot();
    const a = app.actions.addTask("알고리즘 문제 2개 풀기")!;
    const b = app.actions.addTask("운동하기")!;
    expect(app.actions.addTask("   ")).toBeNull();
    // newest first
    expect(app.store.get().tasks.map((t) => t.title)).toEqual(["운동하기", "알고리즘 문제 2개 풀기"]);

    app.actions.setCompleted(a.id, true);
    expect(app.actions.updateTask(b.id, { title: "" })).toBe(false); // empty title refused
    app.actions.updateTask(b.id, { title: "운동하기 (30분)", priority: 3, dueDate: "2026-11-21", description: "스쿼트\n런지" });
    await app.actions.flush();

    app = await restart();
    const tasks = app.store.get().tasks;
    const ra = tasks.find((t) => t.id === a.id)!;
    const rb = tasks.find((t) => t.id === b.id)!;
    expect(ra.completed).toBe(true);
    expect(ra.completedAt).not.toBeNull();
    expect(rb).toMatchObject({ title: "운동하기 (30분)", priority: 3, dueDate: "2026-11-21", description: "스쿼트\n런지" });

    app.actions.setCompleted(a.id, false);
    app.actions.deleteTask(b.id);
    await app.actions.flush();
    app = await restart();
    expect(app.store.get().tasks).toHaveLength(1);
    expect(app.store.get().tasks[0]).toMatchObject({ id: a.id, completed: false, completedAt: null });
  });

  it("undo restores a deleted task", async () => {
    let app = await boot();
    const t = app.actions.addTask("프로젝트 코드 수정")!;
    app.actions.deleteTask(t.id);
    expect(app.store.get().tasks).toHaveLength(0);
    app.store.get().toast!.undo!();
    await app.actions.flush();
    app = await restart();
    expect(app.store.get().tasks.map((x) => x.id)).toEqual([t.id]);
  });

  it("rejects invalid input values", async () => {
    const app = await boot();
    const t = app.actions.addTask("x")!;
    app.actions.updateTask(t.id, { dueDate: "2026-02-31", priority: 9 as 3, planId: "nope" });
    const saved = app.store.get().tasks[0]!;
    expect(saved.dueDate).toBeNull();
    expect(saved.priority).toBe(3);
    expect(saved.planId).toBeNull();
  });

  it("debounces text edits into a single write and flushes on demand", async () => {
    vi.useFakeTimers();
    const app = await boot();
    const t = app.actions.addTask("draft")!;
    await app.actions.flush();
    const spy = vi.spyOn(db, "execute");
    for (const title of ["d", "dr", "dra", "draf", "draft 2"]) app.actions.updateTask(t.id, { title }, TEXT_DEBOUNCE_MS);
    expect(spy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TEXT_DEBOUNCE_MS + 10);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(db.raw.prepare("SELECT title FROM tasks").get()).toEqual(expect.objectContaining({ title: "draft 2" }));
  });

  it("pending debounced edits are saved when closing (flush) before the timer fires", async () => {
    vi.useFakeTimers();
    const app = await boot();
    const t = app.actions.addTask("before close")!;
    app.actions.updateTask(t.id, { description: "typed just now" }, TEXT_DEBOUNCE_MS);
    expect(await app.actions.flush()).toBe(true); // what the close handler does
    db.raw.close();
    const reopened = createTestDb(dbPath);
    expect(reopened.raw.prepare("SELECT description FROM tasks").get()).toEqual(
      expect.objectContaining({ description: "typed just now" }),
    );
    reopened.raw.close();
  });

  it("keeps data in memory and retries when a write fails", async () => {
    const app = await boot();
    db.failWrites = new Error("database is locked");
    const t = app.actions.addTask("must not be lost")!;
    expect(await app.actions.flush()).toBe(false);
    expect(app.store.get().saveError).toBe("database is locked");
    expect(app.store.get().tasks[0]!.id).toBe(t.id); // still visible to the user
    expect(app.actions.hasPendingWrites()).toBe(true);

    db.failWrites = null;
    expect(await app.actions.flush()).toBe(true);
    expect(app.store.get().saveError).toBeNull();
    const again = await restart();
    expect(again.store.get().tasks.map((x) => x.title)).toEqual(["must not be lost"]);
  });

  it("handles rapid consecutive adds and toggles", async () => {
    let app = await boot();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) ids.push(app.actions.addTask(`task ${i}`)!.id);
    for (let i = 0; i < 200; i += 2) app.actions.setCompleted(ids[i]!, true);
    for (let i = 0; i < 200; i += 4) app.actions.setCompleted(ids[i]!, false);
    await app.actions.flush();
    app = await restart();
    const tasks = app.store.get().tasks;
    expect(tasks).toHaveLength(200);
    expect(tasks.filter((t) => t.completed)).toHaveLength(50);
    expect(new Set(tasks.map((t) => t.sortOrder)).size).toBe(200);
  });

  it("reorders tasks and keeps the order after restart", async () => {
    let app = await boot();
    for (const title of ["c", "b", "a"]) app.actions.addTask(title);
    const visible = () => selectVisibleTasks(app.store.get().tasks, "all", "manual", "2026-11-20").active;
    expect(visible().map((t) => t.title)).toEqual(["a", "b", "c"]);
    app.actions.moveTask(visible()[0]!.id, 2, visible()); // a → bottom
    app.actions.moveTask(visible()[1]!.id, 0, visible()); // c → top
    expect(visible().map((t) => t.title)).toEqual(["c", "b", "a"]);
    await app.actions.flush();
    app = await restart();
    expect(visible().map((t) => t.title)).toEqual(["c", "b", "a"]);
  });

  it("renumbers when repeated moves exhaust the gap", async () => {
    let app = await boot();
    for (const title of ["z", "y", "x"]) app.actions.addTask(title);
    const visible = () => selectVisibleTasks(app.store.get().tasks, "all", "manual", "2026-11-20").active;
    // Repeatedly move the last task between the first two: halves the gap each time.
    for (let i = 0; i < 80; i++) {
      const v = visible();
      app.actions.moveTask(v[2]!.id, 1, v);
    }
    const orders = visible().map((t) => t.sortOrder);
    expect(orders[1]! - orders[0]!).toBeGreaterThan(1e-6);
    await app.actions.flush();
    const before = visible().map((t) => t.id);
    app = await restart();
    expect(visible().map((t) => t.id)).toEqual(before);
  });
});

describe("plans", () => {
  it("creates, edits, links tasks, computes progress and persists", async () => {
    let app = await boot();
    const plan = app.actions.addPlan("AI 프로젝트 완성")!;
    app.actions.updatePlan(plan.id, {
      description: "- 데이터셋 준비\n- 모델 학습\n- 성능 테스트\n- GitHub 정리",
      startDate: "2026-11-01",
      endDate: "2026-12-31",
    });
    const titles = ["데이터셋 준비", "모델 학습", "성능 테스트", "GitHub 정리", "발표"];
    const ids = titles.map((t) => app.actions.addTask(t, { planId: plan.id })!.id);
    ids.slice(0, 3).forEach((id) => app.actions.setCompleted(id, true));
    const unlinked = app.actions.addTask("관계없는 일")!;
    app.actions.updateTask(unlinked.id, { planId: plan.id });
    app.actions.updateTask(unlinked.id, { planId: null });
    await app.actions.flush();

    app = await restart();
    const { computeProgress } = await import("../lib/taskLogic");
    expect(computeProgress(app.store.get().tasks).get(plan.id)).toEqual({ done: 3, total: 5, percent: 60 });
    expect(app.store.get().plans[0]).toMatchObject({
      title: "AI 프로젝트 완성",
      startDate: "2026-11-01",
      endDate: "2026-12-31",
    });
    expect(app.actions.updatePlan(plan.id, { title: " " })).toBe(false);
  });

  it("deleting a plan keeps its tasks (unlinked)", async () => {
    let app = await boot();
    const plan = app.actions.addPlan("계획")!;
    app.actions.addTask("연결된 할 일", { planId: plan.id });
    await app.actions.flush();
    app.actions.deletePlan(plan.id);
    expect(app.store.get().tasks[0]!.planId).toBeNull();
    await app.actions.flush();
    app = await restart();
    expect(app.store.get().plans).toEqual([]);
    expect(app.store.get().tasks).toHaveLength(1);
    expect(app.store.get().tasks[0]!.planId).toBeNull();
  });

  it("trigger unlinks tasks at the SQL level too", () => {
    db = createTestDb();
    db.raw.exec(`INSERT INTO plans VALUES ('p','P','',NULL,NULL,0,0);
      INSERT INTO tasks (id,title,plan_id,sort_order,created_at,updated_at) VALUES ('t','T','p',0,0,0);
      PRAGMA foreign_keys = OFF; DELETE FROM plans;`);
    expect(db.raw.prepare("SELECT plan_id FROM tasks").get()).toEqual(expect.objectContaining({ plan_id: null }));
  });

  it("undoing a task delete after its plan was deleted unlinks it", async () => {
    const app = await boot();
    const plan = app.actions.addPlan("계획")!;
    const t = app.actions.addTask("x", { planId: plan.id })!;
    app.actions.deleteTask(t.id);
    const undo = app.store.get().toast!.undo!;
    app.actions.deletePlan(plan.id);
    undo();
    expect(await app.actions.flush()).toBe(true);
    expect(app.store.get().tasks[0]!.planId).toBeNull();
  });
});

describe("settings", () => {
  it("persists settings and ignores invalid stored values", async () => {
    let app = await boot();
    app.actions.setSetting("theme", "dark");
    app.actions.setSetting("alwaysOnTop", true);
    app.actions.setSetting("view", "plans");
    app.actions.setSetting("filter", "today");
    app.actions.setSetting("sort", "priority");
    await app.actions.flush();
    db.raw.exec(`INSERT INTO settings VALUES ('unknown','1') ON CONFLICT DO NOTHING`);
    app = await restart();
    expect(app.store.get().settings).toEqual({
      theme: "dark",
      alwaysOnTop: true,
      view: "plans",
      filter: "today",
      sort: "priority",
    });
    db.raw.exec(`UPDATE settings SET value = '"neon"' WHERE key = 'theme'; UPDATE settings SET value = 'oops' WHERE key = 'sort'`);
    app = await restart();
    expect(app.store.get().settings.theme).toBe("system");
    expect(app.store.get().settings.sort).toBe("manual");
  });
});

describe("scale", () => {
  it("loads 1,000 tasks quickly", async () => {
    let app = await boot();
    for (let i = 0; i < 1000; i++) app.actions.addTask(`task ${i}`, { dueDate: i % 2 ? "2026-11-20" : null });
    await app.actions.flush();
    const start = performance.now();
    app = await restart();
    const ms = performance.now() - start;
    expect(app.store.get().tasks).toHaveLength(1000);
    expect(ms).toBeLessThan(1000);
  });
});
