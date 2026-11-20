import { lazy, Suspense, useEffect, useState } from "react";
import { CloseBlockedDialog, SaveErrorBanner, Toast } from "./components/Notices";
import { TaskView } from "./components/TaskView";
import { TitleBar } from "./components/TitleBar";
import { emitCommand, isTextField } from "./lib/shortcuts";
import { watchTheme } from "./lib/theme";
import { setAlwaysOnTop } from "./lib/window";
import { actions, store, useApp } from "./state/app";
import type { View } from "./types";

// Secondary screens are split out so startup only parses what the first screen needs.
const PlanView = lazy(() => import("./components/PlanView").then((m) => ({ default: m.PlanView })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

const VIEWS: { value: View; label: string }[] = [
  { value: "todo", label: "할 일" },
  { value: "plans", label: "계획" },
];

export function App() {
  const phase = useApp((s) => s.phase);
  const view = useApp((s) => s.settings.view);
  const theme = useApp((s) => s.settings.theme);
  const alwaysOnTop = useApp((s) => s.settings.alwaysOnTop);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ready = phase === "ready";

  useEffect(() => (ready ? watchTheme(theme) : undefined), [ready, theme]);
  useEffect(() => {
    if (ready) setAlwaysOnTop(alwaysOnTop);
  }, [ready, alwaysOnTop]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "n" || k === "f") {
        e.preventDefault();
        setSettingsOpen(false);
        if (k === "f") actions.setSetting("view", "todo");
        // Let the target view mount first if we just switched.
        requestAnimationFrame(() => emitCommand(k === "n" ? "new" : "find"));
      } else if (k === "1" || k === "2") {
        e.preventDefault();
        setSettingsOpen(false);
        actions.setSetting("view", k === "1" ? "todo" : "plans");
      } else if (k === "z" && !isTextField(e.target)) {
        const undo = store.get().toast?.undo;
        if (undo) {
          e.preventDefault();
          undo();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg text-fg">
      <TitleBar onSettings={() => setSettingsOpen((o) => !o)} settingsOpen={settingsOpen} />

      {ready && (
        <nav className="shrink-0 border-b border-line bg-surface px-2 pb-1.5" aria-label="화면">
          <div role="tablist" className="flex gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.value}
                type="button"
                role="tab"
                aria-selected={view === v.value}
                onClick={() => {
                  setSettingsOpen(false);
                  actions.setSetting("view", v.value);
                }}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition-colors ${
                  view === v.value ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <SaveErrorBanner />

      <main className="relative min-h-0 flex-1">
        {phase === "loading" && <p className="p-6 text-center text-xs text-muted">불러오는 중…</p>}
        {phase === "error" && <LoadError />}
        {ready && (
          <Suspense fallback={null}>
            {view === "todo" ? <TaskView /> : <PlanView />}
            {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
          </Suspense>
        )}
      </main>

      <Toast />
      <CloseBlockedDialog />
    </div>
  );
}

function LoadError() {
  const error = useApp((s) => s.loadError);
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-[13px] font-semibold text-danger">데이터베이스를 열 수 없습니다</p>
      <p className="text-xs break-all text-muted">{error}</p>
      <button type="button" onClick={() => void actions.init()} className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs text-white">
        다시 시도
      </button>
    </div>
  );
}
