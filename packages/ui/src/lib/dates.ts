import { format, isBefore, isToday, isTomorrow, isYesterday, parseISO, startOfDay } from "date-fns";

/** The day a due date falls on as written, `YYYY-MM-DD`, also for a date-time. */
export const dueDay = (due: string) => due.slice(0, 10);

export interface DueInfo {
  label: string;
  overdue: boolean;
  today: boolean;
}

/** A due day as rows show it ("Today", "Oct 3"), and whether it is today or past. */
export const dueInfo = (due: string | null): DueInfo | null => {
  if (due === null) return null;
  const date = parseISO(dueDay(due));
  if (Number.isNaN(date.getTime())) return { label: due, overdue: false, today: false };
  const today = isToday(date);
  const overdue = !today && isBefore(date, startOfDay(new Date()));
  let label = format(
    date,
    date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy",
  );
  if (today) label = "Today";
  else if (isTomorrow(date)) label = "Tomorrow";
  else if (isYesterday(date)) label = "Yesterday";
  return { label, overdue, today };
};

export const formatTimestamp = (value: string | null) => {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d, yyyy HH:mm");
};
