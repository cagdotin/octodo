import { addDays, format, parseISO } from "date-fns";

/** The day a due date falls on as written, `YYYY-MM-DD`, also for a date-time. */
export const dueDay = (due: string) => due.slice(0, 10);

export interface DueInfo {
  label: string;
  overdue: boolean;
  today: boolean;
}

const shift = (day: string, days: number) => format(addDays(parseISO(day), days), "yyyy-MM-dd");

/** A due day as rows show it on `today` ("Today", "Oct 3"), and whether it is today or past. */
export const dueInfo = (due: string | null, today: string): DueInfo | null => {
  if (due === null) return null;
  const day = dueDay(due);
  const date = parseISO(day);
  if (Number.isNaN(date.getTime())) return { label: due, overdue: false, today: false };
  const relative =
    day === today
      ? "Today"
      : day === shift(today, 1)
        ? "Tomorrow"
        : day === shift(today, -1)
          ? "Yesterday"
          : undefined;
  const label =
    relative ?? format(date, day.slice(0, 4) === today.slice(0, 4) ? "MMM d" : "MMM d, yyyy");
  return { label, overdue: day < today, today: day === today };
};

export const formatTimestamp = (value: string | null) => {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d, yyyy HH:mm");
};
