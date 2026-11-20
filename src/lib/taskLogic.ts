import type { Filter, Plan, SortMode, Task } from "../types";

export const ORDER_STEP = 1024;
/** Below this gap between neighbours we renumber all sort orders. */
const MIN_GAP = 1e-6;

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 10_000;

/** Trims and validates a title; returns null when it cannot be saved. */
export function cleanTitle(raw: string): string | null {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, TITLE_MAX);
}

function byOrder(a: Task, b: Task) {
  return a.sortOrder - b.sortOrder || a.createdAt - b.createdAt;
}

function comparator(sort: SortMode): (a: Task, b: Task) => number {
  switch (sort) {
    case "due":
      return (a, b) => {
        if (a.dueDate !== b.dueDate) {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate < b.dueDate ? -1 : 1;
        }
        return byOrder(a, b);
      };
    case "priority":
      return (a, b) => b.priority - a.priority || byOrder(a, b);
    default:
      return byOrder;
  }
}

const byCompletedDesc = (a: Task, b: Task) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || byOrder(a, b);

function matches(task: Task, query: string) {
  return task.title.toLowerCase().includes(query) || task.description.toLowerCase().includes(query);
}

export interface VisibleTasks {
  active: Task[];
  done: Task[];
}

/** Single pass partition + sort. Never mutates the input array. */
export function selectVisibleTasks(
  tasks: readonly Task[],
  filter: Filter,
  sort: SortMode,
  today: string,
  query = "",
): VisibleTasks {
  const q = query.trim().toLowerCase();
  const active: Task[] = [];
  const done: Task[] = [];
  for (const t of tasks) {
    if (q && !matches(t, q)) continue;
    if (t.completed) {
      if (filter === "all" || filter === "completed") done.push(t);
      continue;
    }
    if (filter === "completed") continue;
    if (filter === "today" && !(t.dueDate && t.dueDate <= today)) continue;
    if (filter === "upcoming" && !(t.dueDate && t.dueDate > today)) continue;
    active.push(t);
  }
  active.sort(filter === "upcoming" && sort === "manual" ? comparator("due") : comparator(sort));
  done.sort(byCompletedDesc);
  return { active, done };
}

export function countTasks(tasks: readonly Task[], today: string): Record<Filter, number> {
  const c: Record<Filter, number> = { all: 0, today: 0, upcoming: 0, completed: 0 };
  for (const t of tasks) {
    if (t.completed) {
      c.completed++;
      continue;
    }
    c.all++;
    if (t.dueDate) {
      if (t.dueDate <= today) c.today++;
      else c.upcoming++;
    }
  }
  return c;
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

export const EMPTY_PROGRESS: Progress = { done: 0, total: 0, percent: 0 };

export function computeProgress(tasks: readonly Task[]): Map<string, Progress> {
  const map = new Map<string, Progress>();
  for (const t of tasks) {
    if (!t.planId) continue;
    let p = map.get(t.planId);
    if (!p) map.set(t.planId, (p = { done: 0, total: 0, percent: 0 }));
    p.total++;
    if (t.completed) p.done++;
  }
  for (const p of map.values()) p.percent = Math.round((p.done / p.total) * 100);
  return map;
}

/** Sort order value placed between two neighbours (either may be missing). */
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return 0;
  if (prev === undefined) return (next as number) - ORDER_STEP;
  if (next === undefined) return prev + ORDER_STEP;
  return (prev + next) / 2;
}

export function topOrder(tasks: readonly Task[]): number {
  let min = Infinity;
  for (const t of tasks) if (t.sortOrder < min) min = t.sortOrder;
  return min === Infinity ? 0 : min - ORDER_STEP;
}

/**
 * Computes the new sort order for moving `id` to `toIndex` within `list`
 * (the currently visible, manually ordered list). Returns null if nothing changes,
 * or `"renumber"` when neighbours are too close and all orders must be rebuilt.
 */
export function orderForMove(list: readonly Task[], id: string, toIndex: number): number | null | "renumber" {
  const from = list.findIndex((t) => t.id === id);
  if (from < 0) return null;
  const target = Math.max(0, Math.min(list.length - 1, toIndex));
  if (target === from) return null;
  const rest = list.filter((t) => t.id !== id);
  const prev = rest[target - 1]?.sortOrder;
  const next = rest[target]?.sortOrder;
  if (prev !== undefined && next !== undefined && next - prev < MIN_GAP) return "renumber";
  return orderBetween(prev, next);
}

/** Returns tasks re-numbered with even gaps, preserving the given order of `ordered`. */
export function renumber(ordered: readonly Task[]): Map<string, number> {
  const map = new Map<string, number>();
  ordered.forEach((t, i) => map.set(t.id, (i + 1) * ORDER_STEP));
  return map;
}

export function sortPlans(plans: readonly Plan[]): Plan[] {
  return [...plans].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** WebView2 / WebKit expose `crypto.randomUUID` in the app's secure context. */
export function newId(): string {
  return crypto.randomUUID();
}
