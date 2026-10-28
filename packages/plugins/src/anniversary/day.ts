/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;

/** The day it comes back in a year after the one it happened in. */
export interface Occurrence {
  readonly next: Day;
  /** How many years it marks on `next`: 0 when `next` is the day itself. */
  readonly years: number;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** `value` as a day that exists, or why it is not one. */
export const readDay = (value: unknown): { readonly day: Day } | { readonly error: string } => {
  const text = typeof value === "string" ? value.trim() : value;
  const parts = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (parts === null)
    return { error: `The date ${JSON.stringify(value)} is not a day written YYYY-MM-DD` };
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { error: `The date ${text} is not a day the calendar has` };
  return { day: text as Day };
};

/** Today where this runs, the person's computer (decision 0010). */
export const today = (now = new Date()): Day =>
  `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/** The day `date` falls on in `year`; February 29 falls on the 28th in a year without one. */
const inYear = (date: Day, year: number): Day => {
  const monthDay = date.slice(5);
  return `${pad(year, 4)}-${monthDay === "02-29" && !isLeap(year) ? "02-28" : monthDay}`;
};

/** The first day from `from` on, `from` included, that `date` comes back on (or is). */
export const nextOccurrence = (date: Day, from: Day): Occurrence => {
  if (date >= from) return { next: date, years: 0 };
  const born = Number(date.slice(0, 4));
  const thisYear = Number(from.slice(0, 4));
  const year = inYear(date, thisYear) >= from ? thisYear : thisYear + 1;
  return { next: inYear(date, year), years: year - born };
};

/** Whole days from `from` to `to`. */
export const daysBetween = (from: Day, to: Day): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The day an anniversary is due on: its next occurrence from `from` on, none without a date. */
export const occurrenceDay = ({ date }: { readonly date: Day | null }, from: Day): Day | null =>
  date === null ? null : nextOccurrence(date, from).next;
