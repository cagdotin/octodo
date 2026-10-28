import { format } from "date-fns";
import { useSyncExternalStore } from "react";

/** A calendar day where the app runs, `YYYY-MM-DD`. */
export type Day = string;

export const dayOf = (date: Date): Day => format(date, "yyyy-MM-dd");

const listeners = new Set<() => void>();
let midnight: ReturnType<typeof setTimeout> | undefined;

const notify = () => {
  for (const listener of listeners) listener();
};

/** Wakes at the next local midnight; a timer can fire late after sleep, so focus checks too. */
const scheduleMidnight = () => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  midnight = setTimeout(() => {
    notify();
    scheduleMidnight();
  }, next.getTime() - now.getTime());
};

const onVisible = () => {
  if (document.visibilityState === "visible") notify();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    scheduleMidnight();
    window.addEventListener("focus", notify);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearTimeout(midnight);
    window.removeEventListener("focus", notify);
    document.removeEventListener("visibilitychange", onVisible);
  };
};

const today = () => dayOf(new Date());

/**
 * Today, for anything shown relative to it ("Today", "Overdue", the Today view). Re-renders at
 * local midnight and when the window comes back, so an app left open overnight moves on.
 */
export const useToday = (): Day => useSyncExternalStore(subscribe, today, today);
