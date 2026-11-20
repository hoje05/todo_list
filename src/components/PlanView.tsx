import { memo, useEffect, useMemo, useRef, useState } from "react";
import { formatRange } from "../lib/dates";
import { onCommand } from "../lib/shortcuts";
import { EMPTY_PROGRESS, computeProgress, sortPlans, type Progress } from "../lib/taskLogic";
import { useImeSafeSubmit } from "../lib/useImeSafeSubmit";
import { useToday } from "../lib/useToday";
import { actions, useApp } from "../state/app";
import type { Plan } from "../types";
import { CalendarIcon, FolderIcon, PlusIcon } from "./Icons";
import { PlanEditor } from "./PlanEditor";
import { EmptyState, ProgressBar } from "./ui";

const PlanCard = memo(function PlanCard({
  plan,
  progress,
  today,
  onOpen,
}: {
  plan: Plan;
  progress: Progress;
  today: string;
  onOpen: (id: string) => void;
}) {
  const range = formatRange(plan.startDate, plan.endDate, today);
  const overdue = !!plan.endDate && plan.endDate < today && progress.percent < 100;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(plan.id)}
        className="block w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent/60"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-semibold break-words">{plan.title}</span>
          <span className={`shrink-0 text-xs font-semibold tabular-nums ${progress.percent === 100 ? "text-ok" : "text-accent"}`}>
            {progress.percent}%
          </span>
        </span>
        {plan.description && (
          <span className="mt-1 line-clamp-2 text-xs leading-relaxed whitespace-pre-line text-muted">{plan.description}</span>
        )}
        <span className="mt-2 block">
          <ProgressBar percent={progress.percent} />
        </span>
        <span className="mt-1.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="tabular-nums">
            {progress.done}/{progress.total} 완료
          </span>
          {range && (
            <span className={`inline-flex items-center gap-0.5 ${overdue ? "text-danger" : ""}`}>
              <CalendarIcon width={11} height={11} /> {range}
            </span>
          )}
        </span>
      </button>
    </li>
  );
});

export function PlanView() {
  const plans = useApp((s) => s.plans);
  const tasks = useApp((s) => s.tasks);
  const today = useToday();
  const [openId, setOpenId] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => sortPlans(plans), [plans]);
  const progress = useMemo(() => computeProgress(tasks), [tasks]);
  const open = openId ? plans.find((p) => p.id === openId) : undefined;

  useEffect(
    () =>
      onCommand((cmd) => {
        if (cmd === "new") {
          setOpenId(null);
          requestAnimationFrame(() => addRef.current?.focus());
        }
      }),
    [],
  );

  const submitProps = useImeSafeSubmit(() => {
    const input = addRef.current;
    if (!input) return;
    const plan = actions.addPlan(input.value);
    if (plan) {
      input.value = "";
      setOpenId(plan.id);
    } else input.focus();
  });

  return (
    <div className="relative flex h-full flex-col">
      <div className="scroll-area min-h-0 flex-1 p-2">
        {sorted.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
            title="아직 계획이 없습니다"
            hint="중장기 목표를 계획으로 만들고 할 일을 연결하면 진행률을 볼 수 있습니다."
          />
        ) : (
          <ul className="flex flex-col gap-2" aria-label="계획 목록">
            {sorted.map((p) => (
              <PlanCard key={p.id} plan={p} progress={progress.get(p.id) ?? EMPTY_PROGRESS} today={today} onOpen={setOpenId} />
            ))}
          </ul>
        )}
      </div>

      <form {...submitProps} className="flex shrink-0 items-center gap-1.5 border-t border-line bg-surface px-2 py-2">
        <input
          ref={addRef}
          maxLength={200}
          placeholder="새 계획 제목 (Enter)"
          aria-label="새 계획"
          className="min-w-0 flex-1 rounded-md bg-surface-2 px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted/80 focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          aria-label="계획 추가"
          title="계획 추가 (Ctrl+N)"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:brightness-110"
        >
          <PlusIcon />
        </button>
      </form>

      {open && (
        <PlanEditor
          key={open.id}
          plan={open}
          progress={progress.get(open.id) ?? EMPTY_PROGRESS}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
