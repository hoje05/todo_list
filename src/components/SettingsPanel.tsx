import { useEffect, useState, type ReactNode } from "react";
import { appConfigDir } from "@tauri-apps/api/path";
import { inTauri } from "../lib/window";
import { actions, useApp } from "../state/app";
import type { SortMode, Theme } from "../types";
import { BackIcon } from "./Icons";
import { Segmented } from "./ui";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];
const SORTS: { value: SortMode; label: string }[] = [
  { value: "manual", label: "직접 정렬" },
  { value: "due", label: "마감일" },
  { value: "priority", label: "우선순위" },
];
const SHORTCUTS: [string, string][] = [
  ["Ctrl + N", "새 할 일 / 새 계획"],
  ["Ctrl + F", "할 일 검색"],
  ["Ctrl + 1 / 2", "할 일 / 계획 화면"],
  ["Ctrl + Enter", "편집 완료"],
  ["Esc", "편집 취소 · 닫기"],
  ["Alt + ↑ / ↓", "할 일 순서 변경"],
  ["Delete", "선택한 할 일 삭제"],
  ["Ctrl + Z", "삭제 실행 취소"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const [dataDir, setDataDir] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    appConfigDir()
      .then((dir) => alive && setDataDir(dir))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      role="dialog"
      aria-label="설정"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-0 z-20 flex flex-col bg-bg"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-1.5 py-1">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
        >
          <BackIcon width={14} height={14} /> 설정 닫기
        </button>
      </div>
      <div className="scroll-area flex min-h-0 flex-1 flex-col gap-4 p-3">
        <Section title="테마">
          <Segmented label="테마" value={settings.theme} options={THEMES} onChange={(v) => actions.setSetting("theme", v)} />
        </Section>
        <Section title="할 일 정렬">
          <Segmented label="할 일 정렬" value={settings.sort} options={SORTS} onChange={(v) => actions.setSetting("sort", v)} />
          {settings.sort !== "manual" && <p className="text-[11px] text-muted">직접 정렬일 때 드래그나 Alt+↑/↓로 순서를 바꿀 수 있습니다.</p>}
        </Section>
        <Section title="창">
          <label className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
            <span>항상 위에 표시</span>
            <input
              type="checkbox"
              checked={settings.alwaysOnTop}
              onChange={(e) => actions.setSetting("alwaysOnTop", e.target.checked)}
              className="size-4 accent-[var(--accent)]"
            />
          </label>
        </Section>
        <Section title="단축키">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-2 text-xs">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[11px] text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="데이터">
          <p className="rounded-lg bg-surface px-3 py-2 text-xs leading-relaxed text-muted">
            모든 데이터는 이 PC에만 저장되며 외부로 전송되지 않습니다.
            {dataDir && (
              <>
                <br />
                <span className="break-all select-text">{dataDir}</span>
              </>
            )}
          </p>
        </Section>
        <p className="text-center text-[11px] text-muted">DeskTodo v{__APP_VERSION__}</p>
      </div>
    </section>
  );
}
