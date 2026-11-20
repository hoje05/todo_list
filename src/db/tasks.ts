import type { Priority, Task } from "../types";
import type { Db } from "./types";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  priority: number;
  completed: number;
  completed_at: number | null;
  plan_id: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function fromRow(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    priority: Math.min(3, Math.max(0, Number(r.priority) || 0)) as Priority,
    completed: Number(r.completed) === 1,
    completedAt: r.completed_at,
    planId: r.plan_id,
    sortOrder: Number(r.sort_order),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function loadTasks(db: Db): Promise<Task[]> {
  const rows = await db.select<TaskRow[]>(
    `SELECT id, title, description, due_date, priority, completed, completed_at,
            plan_id, sort_order, created_at, updated_at
       FROM tasks ORDER BY sort_order, created_at`,
  );
  return rows.map(fromRow);
}

export async function upsertTask(db: Db, t: Task): Promise<void> {
  await db.execute(
    `INSERT INTO tasks (id, title, description, due_date, priority, completed, completed_at,
                        plan_id, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       due_date = excluded.due_date,
       priority = excluded.priority,
       completed = excluded.completed,
       completed_at = excluded.completed_at,
       plan_id = excluded.plan_id,
       sort_order = excluded.sort_order,
       updated_at = excluded.updated_at`,
    [
      t.id,
      t.title,
      t.description,
      t.dueDate,
      t.priority,
      t.completed ? 1 : 0,
      t.completedAt,
      t.planId,
      t.sortOrder,
      t.createdAt,
      t.updatedAt,
    ],
  );
}

export async function deleteTask(db: Db, id: string): Promise<void> {
  await db.execute("DELETE FROM tasks WHERE id = $1", [id]);
}
