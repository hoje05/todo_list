const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as `YYYY-MM-DD`. */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return toDateKey(new Date(y, m - 1, d + days));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a normalized date key or null for empty/invalid input. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? value : null;
}

export type DueTone = "overdue" | "today" | "soon" | "normal";

/** Short Korean label for a due date relative to today. */
export function describeDue(due: string, today: string): { label: string; tone: DueTone } {
  if (due < today) return { label: due === addDays(today, -1) ? "어제" : formatShort(due, today), tone: "overdue" };
  if (due === today) return { label: "오늘", tone: "today" };
  if (due === addDays(today, 1)) return { label: "내일", tone: "soon" };
  return { label: formatShort(due, today), tone: "normal" };
}

export function formatShort(key: string, today: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return key.slice(0, 4) === today.slice(0, 4) ? `${m}/${d}` : `${y}.${m}.${d}`;
}

export function formatRange(start: string | null, end: string | null, today: string): string | null {
  if (!start && !end) return null;
  const s = start ? formatShort(start, today) : "";
  const e = end ? formatShort(end, today) : "";
  return `${s} ~ ${e}`.trim();
}
