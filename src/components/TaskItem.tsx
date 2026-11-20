import { memo } from "react";
import { describeDue } from "../lib/dates";
import { actions } from "../state/app";
import type { Task } from "../types";
import { CalendarIcon, CheckIcon, FlagIcon, FolderIcon, NoteIcon, TrashIcon } from "./Icons";
import { PRIORITY_COLORS, PRIORITY_LABELS } from "./ui";

const DUE_TONE = {
  overdue: "text-danger",
  today: "text-accent font-medium",
  soon: "text-warn",
  normal: "text-muted",
} as const;

interface Props {
  task: Task;
  today: string;
  planTitle: string | undefined;
  draggable: boolean;
  onEdit: (id: string) => void;
}

/** Memoized: toggling one task re-renders only that row. */
export const TaskItem = memo(function TaskItem({ task, today, planTitle, draggable, onEdit }: Props) {
  const due = task.dueDate ? describeDue(task.dueDate, today) : null;
  const done = task.completed;
  return (
    <li
      data-id={task.id}
      draggable={draggable}
      className="task-row group relative flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2/70"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `'${task.title}' 완료 취소` : `'${task.title}' 완료`}
        onClick={() => actions.setCompleted(task.id, !done)}
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors ${
          done ? "border-accent bg-accent text-white" : "border-muted/50 text-transparent hover:border-accent hover:text-accent/50"
        }`}
      >
        <CheckIcon width={12} height={12} strokeWidth={3} />
      </button>

      <button
        type="button"
        data-row-main
        onClick={() => onEdit(task.id)}
        className="min-w-0 flex-1 text-left outline-none"
        title="클릭하여 편집 · Alt+↑/↓ 순서 변경"
      >
        <span
          className={`block text-[13px] leading-[18px] break-words ${done ? "text-muted line-through decoration-muted/60" : "text-fg"}`}
        >
          {task.title}
        </span>
        {(due || task.priority > 0 || planTitle || task.description) && (
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {due && (
              <span className={`inline-flex items-center gap-0.5 ${done ? "" : DUE_TONE[due.tone]}`}>
                <CalendarIcon width={11} height={11} />
                {due.label}
              </span>
            )}
            {task.priority > 0 && (
              <span className={`inline-flex items-center gap-0.5 ${done ? "" : PRIORITY_COLORS[task.priority]}`}>
                <FlagIcon width={11} height={11} />
                {PRIORITY_LABELS[task.priority]}
              </span>
            )}
            {planTitle && (
              <span className="inline-flex max-w-[140px] items-center gap-0.5 truncate">
                <FolderIcon width={11} height={11} className="shrink-0" />
                <span className="truncate">{planTitle}</span>
              </span>
            )}
            {task.description && <NoteIcon width={11} height={11} aria-label="메모 있음" />}
          </span>
        )}
      </button>

      <button
        type="button"
        aria-label={`'${task.title}' 삭제`}
        title="삭제 (Delete)"
        onClick={() => actions.deleteTask(task.id)}
        className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md text-muted opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger focus:opacity-100"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </li>
  );
});
