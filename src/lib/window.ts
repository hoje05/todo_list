// Native window management. All calls are no-ops outside Tauri (plain browser dev).
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const inTauri = isTauri();

const CLOSE_FLUSH_TIMEOUT_MS = 4000;
let forceClose = false;

function run(action: () => Promise<unknown>) {
  if (!inTauri) return;
  action().catch((e: unknown) => console.error("window action failed", e));
}

/** Called once after the first paint: the window starts hidden to avoid a blank flash. */
export function showWindow() {
  run(async () => {
    const w = getCurrentWindow();
    await w.show();
    await w.setFocus();
  });
}

export const minimizeWindow = () => run(() => getCurrentWindow().minimize());
/** Goes through the close guard below, so pending edits are saved first. */
export const closeWindow = () => run(() => getCurrentWindow().close());
export const setAlwaysOnTop = (on: boolean) => run(() => getCurrentWindow().setAlwaysOnTop(on));

/** Closes without waiting for saves (user explicitly confirmed). */
export function forceCloseWindow() {
  forceClose = true;
  run(() => getCurrentWindow().destroy());
}

/**
 * Before the window closes (close button, Alt+F4, taskbar), flush pending writes.
 * If they cannot be saved, the close is cancelled and `onUnsaved` is called so the
 * user can retry or explicitly discard.
 */
export function installCloseGuard(flush: () => Promise<boolean>, onUnsaved: () => void) {
  if (!inTauri) return;
  void getCurrentWindow().onCloseRequested(async (event) => {
    if (forceClose) return;
    const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), CLOSE_FLUSH_TIMEOUT_MS));
    const ok = await Promise.race([flush().catch(() => false), timeout]);
    if (!ok) {
      event.preventDefault();
      onUnsaved();
    }
  });
}

/** Production only: hide the browser context menu / reload / devtools shortcuts. */
export function installProductionGuards() {
  if (import.meta.env.DEV) return;
  document.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest("input, textarea")) e.preventDefault();
  });
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "f5" || (e.ctrlKey && (k === "r" || k === "p" || k === "g" || k === "u")) || (e.ctrlKey && e.shiftKey && k === "i")) {
      e.preventDefault();
    }
  });
}
