import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { Calendar } from "@octodo/ui/components/calendar";
import { useToday } from "@octodo/ui/hooks/use-today";
import { addDays, format, parseISO } from "date-fns";
import { CalendarHeartIcon, type LucideIcon, TimerIcon, TimerResetIcon } from "lucide-react";
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

/** A counter's kind's icon; the section's own for a counter whose type is unreadable. */
export function KindIcon({
  type,
  className,
}: {
  type: CounterType | null;
  className?: string | undefined;
}) {
  const Icon = type === null ? TimerIcon : KIND[type].Icon;
  return <Icon aria-label={type === null ? "Counter" : KIND[type].label} className={className} />;
}

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
  const run = async <T,>(call: () => Promise<T>): Promise<T | undefined> => {
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
 * A day picker with month and year menus, to reach a birthday in 1961. `past` keeps it to today and
 * before, for when something last happened.
 */
export function DayCalendar({
  value,
  onPick,
  past = false,
}: {
  value: string | null;
  onPick: (day: string) => void;
  past?: boolean;
}) {
  const today = parseISO(useToday());
  const selected = value === null ? today : parseISO(value);
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      startMonth={new Date(1900, 0)}
      endMonth={past ? today : new Date(today.getFullYear() + 10, 11)}
      defaultMonth={selected}
      {...(past ? { disabled: { after: today } } : {})}
      {...(value === null ? {} : { selected })}
      onSelect={(date) => date && onPick(format(date, "yyyy-MM-dd"))}
    />
  );
}
