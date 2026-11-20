import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Priority } from "../types";

export function IconButton({
  label,
  active,
  danger,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
      } ${danger ? "hover:!bg-danger hover:!text-white" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md px-2 py-1 text-xs transition-colors ${
            o.value === value ? "bg-surface font-semibold text-fg shadow-sm dark:bg-line" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[13px] text-fg outline-none placeholder:text-muted/70 focus:border-accent";

export const PRIORITY_LABELS: Record<Priority, string> = { 0: "없음", 1: "낮음", 2: "보통", 3: "높음" };
export const PRIORITY_COLORS: Record<Priority, string> = {
  0: "text-muted",
  1: "text-ok",
  2: "text-warn",
  3: "text-danger",
};

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full origin-left rounded-full transition-transform duration-300 ${percent === 100 ? "bg-ok" : "bg-accent"}`}
        style={{ transform: `scaleX(${percent / 100})` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-10 text-center text-muted">
      <div className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <p className="text-[13px] font-medium text-fg/80">{title}</p>
      {hint && <p className="text-xs leading-relaxed">{hint}</p>}
    </div>
  );
}
