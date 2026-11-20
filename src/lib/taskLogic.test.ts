import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { addDays, describeDue, normalizeDate } from "./dates";
import {
  ORDER_STEP,
  cleanTitle,
  computeProgress,
  countTasks,
  orderBetween,
  orderForMove,
  selectVisibleTasks,
  topOrder,
} from "./taskLogic";

const TODAY = "2026-11-20";
let seq = 0;
function task(p: Partial<Task> = {}): Task {
  seq++;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    description: "",
    dueDate: null,
    priority: 0,
    completed: false,
    completedAt: null,
    planId: null,
    sortOrder: seq * ORDER_STEP,
    createdAt: seq,
    updatedAt: seq,
    ...p,
  };
}

describe("cleanTitle", () => {
  it("rejects empty / whitespace titles", () => {
    expect(cleanTitle("")).toBeNull();
    expect(cleanTitle("   \n\t ")).toBeNull();
  });
  it("trims, collapses whitespace and caps length", () => {
    expect(cleanTitle("  영어   공부 30분 ")).toBe("영어 공부 30분");
    expect(cleanTitle("x".repeat(500))).toHaveLength(200);
  });
});

describe("dates", () => {
  it("validates dates", () => {
    expect(normalizeDate("2026-02-30")).toBeNull();
    expect(normalizeDate("2026-13-01")).toBeNull();
    expect(normalizeDate("abc")).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("2028-02-29")).toBe("2028-02-29");
  });
  it("adds days across month/year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("describes due dates relative to today", () => {
    expect(describeDue(TODAY, TODAY)).toEqual({ label: "오늘", tone: "today" });
    expect(describeDue("2026-11-21", TODAY)).toEqual({ label: "내일", tone: "soon" });
    expect(describeDue("2026-11-19", TODAY).tone).toBe("overdue");
    expect(describeDue("2026-12-25", TODAY).label).toBe("12/25");
    expect(describeDue("2027-01-05", TODAY).label).toBe("2027.1.5");
  });
});

describe("selectVisibleTasks", () => {
  const overdue = task({ title: "overdue", dueDate: "2026-11-18" });
  const today = task({ title: "today", dueDate: TODAY, priority: 3 });
  const later = task({ title: "later", dueDate: "2026-12-01", priority: 1 });
  const soon = task({ title: "soon", dueDate: "2026-11-22" });
  const none = task({ title: "none", description: "알고리즘 문제" });
  const doneOld = task({ title: "done old", completed: true, completedAt: 100 });
  const doneNew = task({ title: "done new", completed: true, completedAt: 200, dueDate: TODAY });
  const all = [overdue, today, later, soon, none, doneOld, doneNew];
  const titles = (ts: Task[]) => ts.map((t) => t.title);

  it("all: active in manual order plus completed (newest first)", () => {
    const r = selectVisibleTasks(all, "all", "manual", TODAY);
    expect(titles(r.active)).toEqual(["overdue", "today", "later", "soon", "none"]);
    expect(titles(r.done)).toEqual(["done new", "done old"]);
  });
  it("today: due today or overdue, not completed", () => {
    const r = selectVisibleTasks(all, "today", "manual", TODAY);
    expect(titles(r.active)).toEqual(["overdue", "today"]);
    expect(r.done).toEqual([]);
  });
  it("upcoming: future due dates sorted by date", () => {
    expect(titles(selectVisibleTasks(all, "upcoming", "manual", TODAY).active)).toEqual(["soon", "later"]);
  });
  it("completed only", () => {
    const r = selectVisibleTasks(all, "completed", "manual", TODAY);
    expect(r.active).toEqual([]);
    expect(titles(r.done)).toEqual(["done new", "done old"]);
  });
  it("sorts by due date (no date last) and by priority", () => {
    expect(titles(selectVisibleTasks(all, "all", "due", TODAY).active)).toEqual([
      "overdue",
      "today",
      "soon",
      "later",
      "none",
    ]);
    expect(titles(selectVisibleTasks(all, "all", "priority", TODAY).active)).toEqual([
      "today",
      "later",
      "overdue",
      "soon",
      "none",
    ]);
  });
  it("searches title and description case-insensitively", () => {
    expect(titles(selectVisibleTasks(all, "all", "manual", TODAY, "알고리즘").active)).toEqual(["none"]);
    expect(titles(selectVisibleTasks(all, "all", "manual", TODAY, "DONE").done)).toHaveLength(2);
  });
  it("does not mutate input", () => {
    const copy = [...all];
    selectVisibleTasks(all, "all", "priority", TODAY);
    expect(all).toEqual(copy);
  });
  it("counts per filter", () => {
    expect(countTasks(all, TODAY)).toEqual({ all: 5, today: 2, upcoming: 2, completed: 2 });
  });
  it("filters 10,000 tasks quickly", () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      task({ dueDate: i % 3 ? addDays(TODAY, (i % 20) - 10) : null, priority: (i % 4) as 0 | 1 | 2 | 3, completed: i % 5 === 0 }),
    );
    const start = performance.now();
    const r = selectVisibleTasks(many, "all", "priority", TODAY, "task");
    const ms = performance.now() - start;
    expect(r.active.length + r.done.length).toBe(10_000);
    expect(ms).toBeLessThan(100);
  });
});

describe("ordering", () => {
  it("orderBetween", () => {
    expect(orderBetween(undefined, undefined)).toBe(0);
    expect(orderBetween(undefined, 10)).toBe(10 - ORDER_STEP);
    expect(orderBetween(10, undefined)).toBe(10 + ORDER_STEP);
    expect(orderBetween(10, 20)).toBe(15);
  });
  it("topOrder is below every existing task", () => {
    const ts = [task({ sortOrder: 5 }), task({ sortOrder: -3 })];
    expect(topOrder(ts)).toBeLessThan(-3);
    expect(topOrder([])).toBe(0);
  });
  it("orderForMove places task between new neighbours", () => {
    const [a, b, c] = [task({ sortOrder: 1 }), task({ sortOrder: 2 }), task({ sortOrder: 3 })];
    const list = [a, b, c];
    expect(orderForMove(list, a.id, 0)).toBeNull();
    const down = orderForMove(list, a.id, 1) as number;
    expect(down).toBeGreaterThan(2);
    expect(down).toBeLessThan(3);
    expect(orderForMove(list, a.id, 2) as number).toBeGreaterThan(3);
    expect(orderForMove(list, c.id, 0) as number).toBeLessThan(1);
    expect(orderForMove(list, "missing", 0)).toBeNull();
  });
  it("asks for renumbering when the gap is exhausted", () => {
    const list = [task({ sortOrder: 1 }), task({ sortOrder: 1 + 1e-9 }), task({ sortOrder: 5 })];
    expect(orderForMove(list, list[2]!.id, 1)).toBe("renumber");
  });
});

describe("computeProgress", () => {
  it("counts linked tasks per plan", () => {
    const ts = [
      task({ planId: "p1", completed: true }),
      task({ planId: "p1", completed: true }),
      task({ planId: "p1", completed: true }),
      task({ planId: "p1" }),
      task({ planId: "p1" }),
      task({ planId: "p2" }),
      task(),
    ];
    const p = computeProgress(ts);
    expect(p.get("p1")).toEqual({ done: 3, total: 5, percent: 60 });
    expect(p.get("p2")).toEqual({ done: 0, total: 1, percent: 0 });
    expect(p.has("none")).toBe(false);
  });
});
