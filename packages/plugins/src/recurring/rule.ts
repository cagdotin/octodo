/**
 * The `repeat` grammar and the next due day it gives. Plain functions over calendar days
 * (`YYYY-MM-DD`), so every client can run them.
 */

export type Unit = "day" | "week" | "month" | "year";

/** Every `every` units after the last time it was done. */
export interface Interval {
  readonly kind: "interval";
  readonly every: number;
  readonly unit: Unit;
}

/** The next of these weekdays, 0 for Sunday to 6 for Saturday. */
export interface Weekdays {
  readonly kind: "weekdays";
  readonly days: ReadonlyArray<number>;
}

/** The next `day` of a month, or the month's last day when it is shorter. */
export interface MonthDay {
  readonly kind: "month-day";
  readonly day: number;
}

export type Rule = Interval | Weekdays | MonthDay;

/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const weekday = (word: string) =>
  WEEKDAYS.findIndex((name) => name === word || (word.length === 3 && name.startsWith(word)));

const ADVERBS: Readonly<Record<string, Unit>> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export const RULE_EXAMPLES =
  "every day, every 3 days, every monday and thursday, monthly on the 1st";

/** Reads a `repeat` rule, or says why it is not one. */
export const parseRule = (text: string): { readonly rule: Rule } | { readonly error: string } => {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  const adverb = ADVERBS[words];
  if (adverb !== undefined) return { rule: { kind: "interval", every: 1, unit: adverb } };

  const interval = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(words);
  if (interval !== null) {
    const every = Number(interval[1] ?? 1);
    if (every >= 1 && every <= 999)
      return { rule: { kind: "interval", every, unit: interval[2] as Unit } };
  }

  const monthDay = /^(?:monthly|every month) on the (\d{1,2})(?:st|nd|rd|th)?$/.exec(words);
  if (monthDay !== null) {
    const day = Number(monthDay[1]);
    if (day >= 1 && day <= 31) return { rule: { kind: "month-day", day } };
  }

  const weekdays = /^every (.+)$/.exec(words);
  if (weekdays !== null) {
    const days = weekdays[1]!.split(/, ?| and /).map(weekday);
    if (days.every((day) => day !== -1))
      return { rule: { kind: "weekdays", days: [...new Set(days)].toSorted((a, b) => a - b) } };
  }

  return {
    error: `The repeat rule ${JSON.stringify(text)} is not one octodo reads (such as ${RULE_EXAMPLES})`,
  };
};

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

const fromUtc = (date: Date): Day =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const toUtc = (day: Day) => new Date(`${day}T00:00:00Z`);

/** The calendar day an instant falls on where this process runs. */
export const localDay = (instant: string): Day | null => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const addDays = (day: Day, days: number): Day => {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
};

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The day `months` later, on the same day of the month or that month's last day. */
const addMonths = (day: Day, months: number, onDay = toUtc(day).getUTCDate()): Day => {
  const date = toUtc(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth();
  return fromUtc(new Date(Date.UTC(year, month, Math.min(onDay, daysInMonth(year, month)))));
};

const after = (rule: Interval, day: Day): Day => {
  switch (rule.unit) {
    case "day":
      return addDays(day, rule.every);
    case "week":
      return addDays(day, rule.every * 7);
    case "month":
      return addMonths(day, rule.every);
    case "year":
      return addMonths(day, rule.every * 12);
  }
};

/** The first day on or after `from` that the calendar rule names. */
const onOrAfter = (rule: Weekdays | MonthDay, from: Day): Day => {
  if (rule.kind === "weekdays") {
    const weekday = toUtc(from).getUTCDay();
    return addDays(from, Math.min(...rule.days.map((day) => (day - weekday + 7) % 7)));
  }
  const thisMonth = addMonths(from, 0, rule.day);
  return thisMonth >= from ? thisMonth : addMonths(from, 1, rule.day);
};

/**
 * The due day after a calendar rule's task, due on `due`, was done on `done`. Done in the due's
 * own period, early or late, it is due on the first matching day after both; done in an earlier
 * period (logged history), the due stays.
 */
const dueAfter = (rule: Weekdays | MonthDay, due: Day | null, done: Day): Day => {
  if (due !== null && onOrAfter(rule, done) < due) return due;
  return onOrAfter(rule, addDays(due !== null && due > done ? due : done, 1));
};

/**
 * When the task is due next, from the days it was done, oldest first. An interval counts from the
 * day it was last done; a calendar rule moves past the due each time was done for. A task never
 * done is due on the day it started (or the first matching day from then), and null without that
 * day.
 */
export const nextDue = (rule: Rule, done: ReadonlyArray<Day>, start: Day | null): Day | null => {
  const last = done.at(-1);
  if (rule.kind === "interval") return last === undefined ? start : after(rule, last);
  return done.reduce<Day | null>(
    (due, day) => dueAfter(rule, due, day),
    start === null ? null : onOrAfter(rule, start),
  );
};

/** The day a recurring task is due on: its `next`, past days included until it is done. */
export const dueDay = ({ next }: { readonly next: Day | null }): Day | null => next;
