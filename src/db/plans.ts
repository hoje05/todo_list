import type { Plan } from "../types";
import type { Db } from "./types";

interface PlanRow {
  id: string;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  created_at: number;
  updated_at: number;
}

export async function loadPlans(db: Db): Promise<Plan[]> {
  const rows = await db.select<PlanRow[]>(
    `SELECT id, title, description, start_date, end_date, created_at, updated_at
       FROM plans ORDER BY updated_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export async function upsertPlan(db: Db, p: Plan): Promise<void> {
  await db.execute(
    `INSERT INTO plans (id, title, description, start_date, end_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       updated_at = excluded.updated_at`,
    [p.id, p.title, p.description, p.startDate, p.endDate, p.createdAt, p.updatedAt],
  );
}

/** Linked tasks are unlinked (not deleted) by the `trg_plans_unlink_tasks` trigger. */
export async function deletePlan(db: Db, id: string): Promise<void> {
  await db.execute("DELETE FROM plans WHERE id = $1", [id]);
}
