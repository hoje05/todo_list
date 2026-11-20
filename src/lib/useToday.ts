import { useEffect, useState } from "react";
import { todayKey } from "./dates";

/**
 * Today's date key. Instead of a timer, it is re-checked when the window regains
 * focus or becomes visible, which is when a date change can matter to the user.
 */
export function useToday(): string {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const check = () => setToday(todayKey());
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return today;
}
