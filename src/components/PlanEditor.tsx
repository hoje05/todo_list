import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useImeSafeSubmit } from "../lib/useImeSafeSubmit";
import { cleanTitle, DESCRIPTION_MAX, TITLE_MAX, type Progress } from "../lib/taskLogic";
import { TEXT_DEBOUNCE_MS } from "../state/actions";
import { actions, useApp } from "../state/app";
import type { Plan } from "../types";
import { BackIcon, CheckIcon, PlusIcon, TrashIcon, UnlinkIcon } from "./Icons";
import { Field, ProgressBar, inputClass } from "./ui";

/** Autosaving plan editor. Escape reverts to the opened values, Ctrl+Enter closes. */
export function PlanEditor({ plan, progress, onClose }: { plan: Plan; progress: Progress; onClose: () => void }) {
  const tasks = useApp((s) => s.tasks);
  const [original] = useState(plan);
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const titleValid = cleanTitle(title) !== null;

  const { linked, linkable } = useMemo(() => {
    const linked = tasks
      .filter((t) => t.planId === plan.id)
      .sort((a, b) => Number(a.completed) - Number(b.completed) || a.sortOrder - b.sortOrder);
    const linkable = tasks.filter((t) => !t.planId && !t.completed).sort((a, b) => a.sortOrder - b.sortOrder);
    return { linked, linkable };
  }, [tasks, plan.id]);

  function save() {
    onClose();
    void actions.flush();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return; // keys belong to the IME while composing
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      actions.updatePlan(plan.id, {
        title: original.title,
        description: original.description,
        startDate: original.startDate,
        endDate: original.endDate,
      });
      onClose();
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      save();
    }
  }

  const addTaskProps = useImeSafeSubmit(() => {
    const input = addRef.current;
    if (input && actions.addTask(input.value, { planId: plan.id })) input.value = "";
    input?.focus();
  });

  return (
    <section role="dialog" aria-label="계획 편집" onKeyDown={onKeyDown} className="absolute inset-0 z-10 flex flex-col bg-bg">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1">
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          <BackIcon width={14} height={14} /> 계획 목록
        </button>
        <div className="flex-1" />
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-[11px]">
            <span className="text-muted">할 일은 유지됩니다</span>
            <button
              type="button"
              autoFocus
              onClick={() => {
                onClose();
                actions.deletePlan(plan.id);
              }}
              className="rounded-md bg-danger px-2 py-1 font-medium text-white"
            >
              삭제
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-2 py-1 text-muted hover:bg-surface-2">
              취소
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="계획 삭제"
            title="계획 삭제"
            onClick={() => setConfirmDelete(true)}
            className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-danger/10 hover:text-danger"
          >
            <TrashIcon width={14} height={14} />
          </button>
        )}
      </div>

      <div className="scroll-area flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div>
          <input
            autoFocus
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value);
              actions.updatePlan(plan.id, { title: e.target.value }, TEXT_DEBOUNCE_MS);
            }}
            aria-label="계획 제목"
            aria-invalid={!titleValid}
            className={`${inputClass} text-[14px] font-semibold ${titleValid ? "" : "!border-danger"}`}
          />
          {!titleValid && <p className="mt-1 text-[11px] text-danger">제목은 비워둘 수 없습니다. 이전 제목이 유지됩니다.</p>}
        </div>

        <div className="flex gap-2">
          <Field label="시작일">
            <input
              type="date"
              value={plan.startDate ?? ""}
              onChange={(e) => actions.updatePlan(plan.id, { startDate: e.target.value || null })}
              className={`${inputClass} py-1`}
            />
          </Field>
          <Field label="종료일">
            <input
              type="date"
              value={plan.endDate ?? ""}
              min={plan.startDate ?? undefined}
              onChange={(e) => actions.updatePlan(plan.id, { endDate: e.target.value || null })}
              className={`${inputClass} py-1`}
            />
          </Field>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">계획 내용</span>
          <textarea
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={6}
            onChange={(e) => {
              setDescription(e.target.value);
              actions.updatePlan(plan.id, { description: e.target.value }, TEXT_DEBOUNCE_MS);
            }}
            placeholder={"- 데이터셋 준비\n- 모델 학습\n- 성능 테스트"}
            className={`${inputClass} min-h-[110px] resize-y leading-relaxed`}
          />
        </label>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted">
            <span>연결된 할 일</span>
            <span className="tabular-nums">
              {progress.done}/{progress.total} 완료 · {progress.percent}%
            </span>
          </div>
          <ProgressBar percent={progress.percent} />

          <ul className="mt-2 flex flex-col">
            {linked.map((t) => (
              <li key={t.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2/70">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.completed}
                  aria-label={`'${t.title}' 완료`}
                  onClick={() => actions.setCompleted(t.id, !t.completed)}
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                    t.completed ? "border-accent bg-accent text-white" : "border-muted/50 text-transparent hover:border-accent"
                  }`}
                >
                  <CheckIcon width={10} height={10} strokeWidth={3} />
                </button>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${t.completed ? "text-muted line-through" : ""}`}>{t.title}</span>
                <button
                  type="button"
                  aria-label={`'${t.title}' 연결 해제`}
                  title="연결 해제 (할 일은 유지)"
                  onClick={() => actions.updateTask(t.id, { planId: null })}
                  className="flex size-6 items-center justify-center rounded text-muted opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
                >
                  <UnlinkIcon width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>

          <form {...addTaskProps} className="mt-1.5 flex items-center gap-1.5">
            <input
              ref={addRef}
              maxLength={200}
              placeholder="이 계획에 할 일 추가 (Enter)"
              aria-label="계획에 할 일 추가"
              className={`${inputClass} py-1`}
            />
            <button type="submit" aria-label="추가" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-white">
              <PlusIcon width={14} height={14} />
            </button>
          </form>

          {linkable.length > 0 && (
            <select
              value=""
              aria-label="기존 할 일 연결"
              onChange={(e) => e.target.value && actions.updateTask(e.target.value, { planId: plan.id })}
              className={`${inputClass} mt-1.5 py-1 text-xs text-muted`}
            >
              <option value="">기존 할 일 연결…</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[11px] text-muted">
        자동 저장 · <kbd>Ctrl+Enter</kbd> 완료 · <kbd>Esc</kbd> 변경 취소
      </p>
    </section>
  );
}
