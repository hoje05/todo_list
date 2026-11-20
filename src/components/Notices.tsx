import { useEffect, useState } from "react";
import { forceCloseWindow } from "../lib/window";
import { actions, store, useApp } from "../state/app";

const TOAST_MS = 5000;

export function Toast() {
  const toast = useApp((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => actions.dismissToast(toast.id), TOAST_MS); // one-shot, cleared on change
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className="pointer-events-auto absolute right-2 bottom-14 left-2 z-30 flex items-center gap-2 rounded-lg bg-fg px-3 py-2 text-xs text-bg shadow-lg"
    >
      <span className="min-w-0 flex-1 truncate">{toast.message}</span>
      {toast.undo && (
        <button type="button" onClick={toast.undo} className="shrink-0 font-semibold text-accent-soft underline-offset-2 hover:underline">
          실행 취소
        </button>
      )}
    </div>
  );
}

export function SaveErrorBanner() {
  const error = useApp((s) => s.saveError);
  const [retrying, setRetrying] = useState(false);
  if (!error) return null;
  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 bg-danger px-3 py-1.5 text-xs text-white">
      <span className="min-w-0 flex-1">
        저장하지 못했습니다. 작성 내용은 보존되어 있습니다.
        <span className="block truncate opacity-80" title={error}>
          {error}
        </span>
      </span>
      <button
        type="button"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          await actions.flush();
          setRetrying(false);
        }}
        className="shrink-0 rounded bg-white/20 px-2 py-1 font-medium hover:bg-white/30 disabled:opacity-60"
      >
        {retrying ? "저장 중…" : "다시 시도"}
      </button>
    </div>
  );
}

export function CloseBlockedDialog() {
  const open = useApp((s) => s.closeBlocked);
  if (!open) return null;
  const dismiss = () => store.set((s) => ({ ...s, closeBlocked: false }));
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-label="저장되지 않은 변경사항" className="w-full rounded-xl border border-line bg-surface p-4 shadow-xl">
        <p className="text-[13px] font-semibold">저장되지 않은 변경사항이 있습니다</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          데이터베이스에 저장하지 못했습니다. 다시 시도하거나, 변경사항을 버리고 종료할 수 있습니다.
        </p>
        <div className="mt-3 flex justify-end gap-1.5 text-xs">
          <button type="button" onClick={dismiss} className="rounded-md px-2.5 py-1.5 text-muted hover:bg-surface-2">
            취소
          </button>
          <button type="button" onClick={forceCloseWindow} className="rounded-md px-2.5 py-1.5 text-danger hover:bg-danger/10">
            버리고 종료
          </button>
          <button
            type="button"
            autoFocus
            onClick={async () => {
              if (await actions.flush()) forceCloseWindow();
            }}
            className="rounded-md bg-accent px-2.5 py-1.5 font-medium text-white"
          >
            다시 시도
          </button>
        </div>
      </div>
    </div>
  );
}
