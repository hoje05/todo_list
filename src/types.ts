/** 0 = 없음, 1 = 낮음, 2 = 보통, 3 = 높음 */
export type Priority = 0 | 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  description: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  dueDate: string | null;
  priority: Priority;
  completed: boolean;
  completedAt: number | null;
  planId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export type Theme = "system" | "light" | "dark";
export type View = "todo" | "plans";
export type Filter = "all" | "today" | "upcoming" | "completed";
export type SortMode = "manual" | "due" | "priority";

export interface Settings {
  theme: Theme;
  alwaysOnTop: boolean;
  view: View;
  filter: Filter;
  sort: SortMode;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  alwaysOnTop: false,
  view: "todo",
  filter: "all",
  sort: "manual",
};
