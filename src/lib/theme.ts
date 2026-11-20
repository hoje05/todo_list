import type { Theme } from "../types";

const KEY = "desktodo-theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media().matches));
}

/**
 * The DB is the source of truth; localStorage only mirrors the theme so the very
 * first paint (before the DB is open) already uses the right colors.
 */
export function applyCachedTheme() {
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(KEY);
  } catch {
    /* storage unavailable */
  }
  applyTheme(cached === "light" || cached === "dark" ? cached : "system");
}

/** Applies the theme and follows OS changes while in "system" mode. Returns cleanup. */
export function watchTheme(theme: Theme): () => void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  if (theme !== "system") return () => {};
  const mql = media();
  const onChange = () => applyTheme("system");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
