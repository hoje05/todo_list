import { loadPlans } from "../db/plans";
import { loadSettings } from "../db/settings";
import { loadTasks } from "../db/tasks";
import type { Db } from "../db/types";
import { normalizeDate } from "../lib/dates";
import { DESCRIPTION_MAX, cleanTitle, newId, orderForMove, renumber, topOrder } from "../lib/taskLogic";
import type { Plan, Priority, Settings, Task } from "../types";
import { initialState, type AppState } from "./appState";
import { Saver, errorMessage } from "./saver";
import { createStore } from "./store";

/** Debounce for text edits (title / description typing). */
export const TEXT_DEBOUNCE_MS = 500;
/** Debounce for cheap UI preferences that can change rapidly (tab clicks). */
const PREF_DEBOUNCE_MS = 300;

export type TaskPatch = Partial<Pick<Task, "title" | "description" | "dueDate" | "priority" | "planId">>;
export type PlanPatch = Partial<Pick<Plan, "title" | "description" | "startDate" | "endDate">>;

const clampPriority = (p: number): Priority => Math.min(3, Math.max(0, Math.round(p))) as Priority;

export function createApp(openDb: () => Promise<Db>, now: () => number = Date.now) {
  const store = createStore<AppState>(initialState);
  const saver = new Saver(store.get, (saveError) => store.set((s) => ({ ...s, saveError })));
  let toastSeq = 0;

  const setTasks = (fn: (tasks: Task[]) => Task[]) => store.set((s) => ({ ...s, tasks: fn(s.tasks) }));
  const setPlans = (fn: (plans: Plan[]) => Plan[]) => store.set((s) => ({ ...s, plans: fn(s.plans) }));
  const findTask = (id: string) => store.get().tasks.find((t) => t.id === id);

  function showToast(message: string, undo?: () => void) {
    store.set((s) => ({ ...s, toast: { id: ++toastSeq, message, undo } }));
  }

  function sanitizeTaskPatch(patch: TaskPatch): TaskPatch | null {
    const out: TaskPatch = {};
    if (patch.title !== undefined) {
      const title = cleanTitle(patch.title);
      if (!title) return null; // empty titles are never saved
      out.title = title;
    }
    if (patch.description !== undefined) out.description = patch.description.slice(0, DESCRIPTION_MAX);
    if (patch.dueDate !== undefined) out.dueDate = normalizeDate(patch.dueDate);
    if (patch.priority !== undefined) out.priority = clampPriority(patch.priority);
    if (patch.planId !== undefined) {
      out.planId = patch.planId && store.get().plans.some((p) => p.id === patch.planId) ? patch.planId : null;
    }
    return out;
  }

  const actions = {
    async init(): Promise<void> {
      store.set((s) => ({ ...s, phase: "loading", loadError: null }));
      try {
        const db = await openDb();
        const [tasks, plans, settings] = await Promise.all([loadTasks(db), loadPlans(db), loadSettings(db)]);
        saver.db = db;
        store.set((s) => ({ ...s, phase: "ready", tasks, plans, settings }));
      } catch (e) {
        console.error("Failed to open database", e);
        store.set((s) => ({ ...s, phase: "error", loadError: errorMessage(e) }));
      }
    },

    addTask(rawTitle: string, extra: { planId?: string | null; dueDate?: string | null } = {}): Task | null {
      const title = cleanTitle(rawTitle);
      if (!title) return null;
      const ts = now();
      const plans = store.get().plans;
      const task: Task = {
        id: newId(),
        title,
        description: "",
        dueDate: normalizeDate(extra.dueDate),
        priority: 0,
        completed: false,
        completedAt: null,
        planId: extra.planId && plans.some((p) => p.id === extra.planId) ? extra.planId : null,
        sortOrder: topOrder(store.get().tasks),
        createdAt: ts,
        updatedAt: ts,
      };
      setTasks((tasks) => [task, ...tasks]);
      saver.mark({ kind: "task", id: task.id });
      return task;
    },

    /** Returns false (and changes nothing) if the patch is invalid, e.g. an empty title. */
    updateTask(id: string, patch: TaskPatch, debounceMs = 0): boolean {
      const clean = sanitizeTaskPatch(patch);
      if (!clean) return false;
      const current = findTask(id);
      if (!current) return false;
      const changed = (Object.keys(clean) as (keyof TaskPatch)[]).some((k) => clean[k] !== current[k]);
      if (!changed) return true;
      const ts = now();
      setTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, ...clean, updatedAt: ts } : t)));
      saver.mark({ kind: "task", id }, debounceMs);
      return true;
    },

    setCompleted(id: string, completed: boolean): void {
      const ts = now();
      setTasks((tasks) =>
        tasks.map((t) =>
          t.id === id && t.completed !== completed
            ? { ...t, completed, completedAt: completed ? ts : null, updatedAt: ts }
            : t,
        ),
      );
      saver.mark({ kind: "task", id });
    },

    deleteTask(id: string): void {
      const task = findTask(id);
      if (!task) return;
      setTasks((tasks) => tasks.filter((t) => t.id !== id));
      saver.mark({ kind: "task", id });
      showToast(`'${task.title}' 삭제됨`, () => actions.restoreTask(task));
    },

    restoreTask(task: Task): void {
      if (findTask(task.id)) return;
      const planOk = !task.planId || store.get().plans.some((p) => p.id === task.planId);
      const restored = planOk ? task : { ...task, planId: null };
      setTasks((tasks) => [...tasks, restored]);
      saver.mark({ kind: "task", id: task.id });
      store.set((s) => ({ ...s, toast: null }));
    },

    /** Moves a task to `toIndex` of `visible` (the list the user is looking at). */
    moveTask(id: string, toIndex: number, visible: readonly Task[]): void {
      const order = orderForMove(visible, id, toIndex);
      if (order === null) return;
      if (order !== "renumber") {
        setTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, sortOrder: order } : t)));
        saver.mark({ kind: "task", id });
        return;
      }
      // Gap exhausted (very rare): rebuild every order value with even spacing.
      const all = [...store.get().tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
      const moved = all.find((t) => t.id === id);
      if (!moved) return;
      const rest = all.filter((t) => t.id !== id);
      const visibleRest = visible.filter((t) => t.id !== id);
      const target = Math.max(0, Math.min(visible.length - 1, toIndex));
      const before = visibleRest[target]; // the task we end up directly above
      const after = visibleRest[target - 1]; // or directly below
      let at = rest.length;
      if (before) at = rest.findIndex((t) => t.id === before.id);
      else if (after) at = rest.findIndex((t) => t.id === after.id) + 1;
      rest.splice(at < 0 ? rest.length : at, 0, moved);
      const orders = renumber(rest);
      setTasks((tasks) => tasks.map((t) => ({ ...t, sortOrder: orders.get(t.id) ?? t.sortOrder })));
      for (const t of rest) saver.mark({ kind: "task", id: t.id });
    },

    addPlan(rawTitle: string): Plan | null {
      const title = cleanTitle(rawTitle);
      if (!title) return null;
      const ts = now();
      const plan: Plan = { id: newId(), title, description: "", startDate: null, endDate: null, createdAt: ts, updatedAt: ts };
      setPlans((plans) => [plan, ...plans]);
      saver.mark({ kind: "plan", id: plan.id });
      return plan;
    },

    updatePlan(id: string, patch: PlanPatch, debounceMs = 0): boolean {
      const out: PlanPatch = {};
      if (patch.title !== undefined) {
        const title = cleanTitle(patch.title);
        if (!title) return false;
        out.title = title;
      }
      if (patch.description !== undefined) out.description = patch.description.slice(0, DESCRIPTION_MAX);
      if (patch.startDate !== undefined) out.startDate = normalizeDate(patch.startDate);
      if (patch.endDate !== undefined) out.endDate = normalizeDate(patch.endDate);
      const current = store.get().plans.find((p) => p.id === id);
      if (!current) return false;
      if (!(Object.keys(out) as (keyof PlanPatch)[]).some((k) => out[k] !== current[k])) return true;
      const ts = now();
      setPlans((plans) => plans.map((p) => (p.id === id ? { ...p, ...out, updatedAt: ts } : p)));
      saver.mark({ kind: "plan", id }, debounceMs);
      return true;
    },

    /** Deletes the plan only; its tasks are kept and simply unlinked. */
    deletePlan(id: string): void {
      const plan = store.get().plans.find((p) => p.id === id);
      if (!plan) return;
      store.set((s) => ({
        ...s,
        plans: s.plans.filter((p) => p.id !== id),
        tasks: s.tasks.some((t) => t.planId === id)
          ? s.tasks.map((t) => (t.planId === id ? { ...t, planId: null } : t))
          : s.tasks,
      }));
      saver.mark({ kind: "plan", id });
      showToast(`계획 '${plan.title}' 삭제됨 (연결된 할 일은 유지)`);
    },

    setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
      if (store.get().settings[key] === value) return;
      store.set((s) => ({ ...s, settings: { ...s.settings, [key]: value } }));
      const cheap = key === "view" || key === "filter" || key === "sort";
      saver.mark({ kind: "setting", id: key }, cheap ? PREF_DEBOUNCE_MS : 0);
    },

    dismissToast(id: number): void {
      store.set((s) => (s.toast?.id === id ? { ...s, toast: null } : s));
    },

    /** Writes everything pending; resolves true when all data is safely stored. */
    flush: () => saver.flush(),
    hasPendingWrites: () => saver.hasPending,
  };

  return { store, actions };
}

export type AppActions = ReturnType<typeof createApp>["actions"];
