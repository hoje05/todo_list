import { useState, type KeyboardEvent } from "react";
import { addDays } from "../lib/dates";
import { cleanTitle, DESCRIPTION_MAX, TITLE_MAX } from "../lib/taskLogic";
import { useToday } from "../lib/useToday";
import { TEXT_DEBOUNCE_MS } from "../state/actions";
import { actions, useApp } from "../state/app";
import type { Priority, Task } from "../types";
import { BackIcon, CheckIcon, TrashIcon } from "./Icons";
import { Field, PRIORITY_LABELS, Segmented, inputClass } from "./ui";

const PRIORITIES = ([0, 1, 2, 3] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABELS[p] }));

/**
 * Full-panel editor. Every change is autosaved (text debounced); Escape reverts
 * to the values the editor was opened with, Ctrl+Enter saves and closes.
 */
export function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const plans = useApp((s) => s.plans);
  const today = useToday();
  const [original] = useState(task);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const titleValid = cleanTitle(title) !== null;

  function save() {
    onClose();
    void actions.flush();
  }

  function cancel() {
    actions.updateTask(task.id, {
      title: original.title,
      description: original.description,
      dueDate: original.dueDate,
      priority: original.priority,
      planId: original.planId,
    });
    if (task.completed !== original.completed) actions.setCompleted(task.id, original.completed);
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      save();
    }
  }

  const setDue = (dueDate: string | null) => actions.updateTask(task.id, { dueDate });
  const chip = "rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:border-accent hover:text-accent";

  return (
    <section
      role="dialog"
      aria-label="할 일 편집"
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-10 flex flex-col bg-bg"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1">
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          <BackIcon width={14} height={14} /> 목록
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => actions.setCompleted(task.id, !task.completed)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
            task.completed ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
          }`}
        >
          <CheckIcon width={13} height={13} /> {task.completed ? "완료됨" : "완료로 표시"}
        </button>
        <button
          type="button"
          aria-label="할 일 삭제"
          title="삭제"
          onClick={() => {
            onClose();
            actions.deleteTask(task.id);
          }}
          className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
        >
          <TrashIcon width={14} height={14} />
        </button>
      </div>

      <div className="scroll-area flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div>
          <input
            autoFocus
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value);
              actions.updateTask(task.id, { title: e.target.value }, TEXT_DEBOUNCE_MS);
            }}
            aria-label="제목"
            aria-invalid={!titleValid}
            placeholder="제목"
            className={`${inputClass} text-[14px] font-medium ${titleValid ? "" : "!border-danger"}`}
          />
          {!titleValid && <p className="mt-1 text-[11px] text-danger">제목은 비워둘 수 없습니다. 이전 제목이 유지됩니다.</p>}
        </div>

        <Field label="마감일">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => setDue(e.target.value || null)}
              className={`${inputClass} w-auto py-1`}
            />
            <button type="button" className={chip} onClick={() => setDue(today)}>
              오늘
            </button>
            <button type="button" className={chip} onClick={() => setDue(addDays(today, 1))}>
              내일
            </button>
            <button type="button" className={chip} onClick={() => setDue(addDays(today, 7))}>
              다음 주
            </button>
            {task.dueDate && (
              <button type="button" className={chip} onClick={() => setDue(null)}>
                지우기
              </button>
            )}
          </div>
        </Field>

        <Field label="우선순위">
          <Segmented
            label="우선순위"
            value={task.priority}
            options={PRIORITIES}
            onChange={(priority) => actions.updateTask(task.id, { priority })}
          />
        </Field>

        <Field label="계획">
          <select
            value={task.planId ?? ""}
            onChange={(e) => actions.updateTask(task.id, { planId: e.target.value || null })}
            className={inputClass}
          >
            <option value="">연결 안 함</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex min-h-[120px] flex-1 flex-col">
          <span className="mb-1 block text-[11px] font-medium text-muted">메모</span>
          <textarea
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => {
              setDescription(e.target.value);
              actions.updateTask(task.id, { description: e.target.value }, TEXT_DEBOUNCE_MS);
            }}
            placeholder="세부 내용을 적어보세요"
            className={`${inputClass} flex-1 resize-none leading-relaxed`}
          />
        </label>
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        자동 저장 · <kbd>Ctrl+Enter</kbd> 완료 · <kbd>Esc</kbd> 변경 취소
      </p>
    </section>
  );
}
