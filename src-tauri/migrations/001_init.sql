-- DeskTodo schema v1
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  start_date  TEXT,
  end_date    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY NOT NULL,
  title        TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description  TEXT NOT NULL DEFAULT '',
  due_date     TEXT,
  priority     INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
  completed    INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  completed_at INTEGER,
  plan_id      TEXT REFERENCES plans(id) ON DELETE SET NULL,
  sort_order   REAL NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sort ON tasks(sort_order);

-- Deleting a plan never deletes its tasks: unlink them atomically, even if
-- foreign key enforcement happens to be off on a connection.
CREATE TRIGGER IF NOT EXISTS trg_plans_unlink_tasks
BEFORE DELETE ON plans
BEGIN
  UPDATE tasks SET plan_id = NULL WHERE plan_id = OLD.id;
END;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
