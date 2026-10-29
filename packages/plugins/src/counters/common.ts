import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { addDays, format, parseISO } from "date-fns";
import { CakeIcon, CalendarHeartIcon, type LucideIcon, TimerResetIcon } from "lucide-react";
import { useState } from "react";
import type { EntryOf } from "../web.ts";
import { nextOccurrence, type CounterFields, type CounterType } from "./count.ts";
import type { countersShared } from "./shared.ts";

export const api = createClient<ServedApi<typeof countersShared.operations>>("");

export type Counter = EntryOf<CounterFields>;

export const KIND: Record<CounterType, { readonly label: string; readonly Icon: LucideIcon }> = {
  since: { label: "Days since", Icon: TimerResetIcon },
  yearly: { label: "Every year", Icon: CalendarHeartIcon },
};

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const SUFFIX: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

/** 1st, 2nd, 3rd, 11th, 21st... */
export const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (SUFFIX[n % 10] ?? "th")}`;
};

export const longDay = (day: string) => format(parseISO(day), "MMM d, yyyy");
export const shortDay = (day: string) => format(parseISO(day), "MMM d");
export const weekday = (day: string) => format(parseISO(day), "EEEE");

/** How a yearly counter's next day reads: "First", "65th". */
export const marks = (years: number) => (years === 0 ? "First" : ordinal(years));

/** The next `n` days `date` comes back on, from `today` on. */
export const occurrences = (date: string, today: string, n: number) => {
  const days: Array<{ next: string; years: number }> = [];
  let from = today;
  for (let index = 0; index < n; index++) {
    const occurrence = nextOccurrence(date, from);
    days.push(occurrence);
    from = format(addDays(parseISO(occurrence.next), 1), "yyyy-MM-dd");
  }
  return days;
};

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Runs one call at a time and keeps its error, for a control that changes a counter. */
export const useCall = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T>(call: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await call();
      setError(null);
      return result;
    } catch (cause) {
      setError(message(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
};

/** Records that it happened: now, or on `at` (`YYYY-MM-DD`). */
export const reset = (workspace: string, id: string, at?: string) =>
  api.request("POST /api/workspaces/:workspace/counters/:id/resets", {
    params: { workspace, id },
    payload: at === undefined ? {} : { at },
  });

export const unreset = (workspace: string, id: string, at: string) =>
  api.request("DELETE /api/workspaces/:workspace/counters/:id/resets/:at", {
    params: { workspace, id, at },
  });

export const setDate = (workspace: string, id: string, date: string) =>
  api.request("PATCH /api/workspaces/:workspace/counters/:id", {
    params: { workspace, id },
    payload: { date },
  });

export const remove = (workspace: string, id: string) =>
  api.request("DELETE /api/workspaces/:workspace/counters/:id", { params: { workspace, id } });

/**
 * What the dialog starts a counter from. A birthday and an anniversary are both yearly counters;
 * the template only words the dialog.
 */
export const TEMPLATES = {
  since: {
    type: "since",
    label: "Days since",
    hint: "Counts up from the last time it happened.",
    Icon: TimerResetIcon,
    placeholder: "Since I last smoked",
    day: "Last happened",
  },
  birthday: {
    type: "yearly",
    label: "Birthday",
    hint: "Comes back every year on the day someone was born.",
    Icon: CakeIcon,
    placeholder: "Mum's birthday",
    day: "Born on",
  },
  anniversary: {
    type: "yearly",
    label: "Anniversary",
    hint: "Comes back every year on the day it first happened.",
    Icon: CalendarHeartIcon,
    placeholder: "Our wedding",
    day: "First happened on",
  },
} as const satisfies Record<
  string,
  {
    type: CounterType;
    label: string;
    hint: string;
    Icon: LucideIcon;
    placeholder: string;
    day: string;
  }
>;

export type Template = keyof typeof TEMPLATES;
