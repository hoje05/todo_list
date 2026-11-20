import { DEFAULT_SETTINGS, type Plan, type Settings, type Task } from "../types";

export interface Toast {
  id: number;
  message: string;
  /** When present an "실행 취소" button is shown. */
  undo?: () => void;
}

export interface AppState {
  phase: "loading" | "ready" | "error";
  loadError: string | null;
  tasks: Task[];
  plans: Plan[];
  settings: Settings;
  /** Non-null while some changes could not be written to disk. */
  saveError: string | null;
  toast: Toast | null;
  /** True when the user tried to close the window but pending changes could not be saved. */
  closeBlocked: boolean;
}

export const initialState: AppState = {
  phase: "loading",
  loadError: null,
  tasks: [],
  plans: [],
  settings: DEFAULT_SETTINGS,
  saveError: null,
  toast: null,
  closeBlocked: false,
};
