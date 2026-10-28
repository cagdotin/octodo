/**
 * What a counter shows, counted from today where the code runs: the engine's on the person's
 * computer, the app's in the browser. Plain functions, so the web half runs them too.
 */
import { localDay } from "@octodo/contract/rules";

/** The kinds of counter, by the `type` in `counter.md`. */
export const COUNTER_TYPES = ["since", "yearly"] as const;
export type CounterType = (typeof COUNTER_TYPES)[number];

/** What the counters plugin reads from a counter, every value absolute (decisions 0019, 0020). */
export interface CounterFields {
  /** Null when `type` is not one of `COUNTER_TYPES`. */
  readonly type: CounterType | null;
  /** A since counter's start of the count: its last reset, or when it was created. */
  readonly since: string | null;
  /** A since counter's last reset; null if never. */
  readonly last: string | null;
  /** A yearly counter's first day, `YYYY-MM-DD`; null when it cannot be read. */
  readonly date: string | null;
}

/** What a counter shows today: the days since, or the next occurrence and the days until it. */
export type Count =
  | { readonly daysSince: number }
  | {
      readonly next: string;
      readonly daysUntil: number;
      /** The years it marks on `next`: 0 when `next` is the first day itself. */
      readonly years: number;
    };

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** `value` as a day that exists, or why it is not one. */
export const readDay = (value: unknown): { readonly day: string } | { readonly error: string } => {
  const text = typeof value === "string" ? value.trim() : value;
  const parts = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (parts === null)
    return { error: `The date ${JSON.stringify(value)} is not a day written YYYY-MM-DD` };
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { error: `The date ${text} is not a day the calendar has` };
  return { day: parts[0] };
};

/** The day `date` falls on in `year`; February 29 falls on the 28th in a year without one. */
const inYear = (date: string, year: number) => {
  const monthDay = date.slice(5);
  return `${pad(year, 4)}-${monthDay === "02-29" && !isLeap(year) ? "02-28" : monthDay}`;
};

/** The first day from `from` on, `from` included, that `date` comes back on (or is). */
export const nextOccurrence = (date: string, from: string) => {
  if (date >= from) return { next: date, years: 0 };
  const born = Number(date.slice(0, 4));
  const thisYear = Number(from.slice(0, 4));
  const year = inYear(date, thisYear) >= from ? thisYear : thisYear + 1;
  return { next: inYear(date, year), years: year - born };
};

/** Whole days from the day `from` to the day `to`. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The counter's count on `today`; null when what it counts from cannot be read. */
export const countOf = (fields: CounterFields, today: string): Count | null => {
  if (fields.type === "since") {
    const start = fields.since === null ? Number.NaN : Date.parse(fields.since);
    return Number.isNaN(start)
      ? null
      : { daysSince: daysBetween(localDay(new Date(start)), today) };
  }
  if (fields.type === "yearly" && fields.date !== null) {
    const { next, years } = nextOccurrence(fields.date, today);
    return { next, daysUntil: daysBetween(today, next), years };
  }
  return null;
};

/** The day a counter falls on, which Today and Next 7 days list: a yearly one's next occurrence. */
export const counterDay = (fields: CounterFields, today: string): string | null => {
  const count = countOf(fields, today);
  return count !== null && "next" in count ? count.next : null;
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** A few words on a counter's count today: `12 days since 2026-10-16`. */
export const countText = (fields: CounterFields, today: string): string => {
  const count = countOf(fields, today);
  if (count === null) return fields.type === null ? "no type" : "no date";
  if ("daysSince" in count)
    return `${plural(count.daysSince, "day")} since ${localDay(new Date(fields.since!))}`;
  const when = count.daysUntil === 0 ? "today" : `in ${plural(count.daysUntil, "day")}`;
  return count.years === 0
    ? `first on ${count.next}, ${when}`
    : `${plural(count.years, "year")} on ${count.next}, ${when}`;
};
