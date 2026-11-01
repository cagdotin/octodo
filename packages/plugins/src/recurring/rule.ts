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

/** Every year on `month` (1 to 12) and `day`, or that month's last day when it is shorter. */
export interface YearDay {
  readonly kind: "year-day";
  readonly month: number;
  readonly day: number;
}

/**
 * The `nth` (1 to 5, or -1 for the last) `weekday` of every month, or of `month` only, and then
 * `after` days later: Black Friday is the day after the fourth Thursday of November.
 */
export interface NthWeekday {
  readonly kind: "nth-weekday";
  readonly nth: number;
  readonly weekday: number;
  readonly month: number | null;
  readonly after: number;
}

type Calendar = Weekdays | MonthDay | YearDay | NthWeekday;

export type Rule = Interval | Calendar;

/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
};

/** A full name or its first three letters, as its index; -1 for neither. */
const named = (names: ReadonlyArray<string>, word: string) =>
  names.findIndex((name) => name === word || (word.length === 3 && name.startsWith(word)));

const weekday = (word: string) => named(WEEKDAYS, word);

/** 1 for January to 12 for December; 0 for a word that is not a month. */
const month = (word: string) => named(MONTHS, word) + 1;

const ADVERBS: Readonly<Record<string, Unit>> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

export const RULE_EXAMPLES =
  "every day, every 3 days, every monday and thursday, monthly on the 1st, yearly on november 27, yearly on the day after the fourth thursday of november";

const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;

const yearDayRule = (words: string): YearDay | null => {
  const match = new RegExp(
    `^(?:yearly|every year) on (?:the )?(?:([a-z]+) ${DAY}|${DAY} (?:of )?([a-z]+))$`,
  ).exec(words);
  if (match === null) return null;
  const inMonth = month(match[1] ?? match[4]!);
  const day = Number(match[2] ?? match[3]);
  const longest = inMonth === 0 ? 0 : daysInMonth(2000, inMonth - 1);
  return day >= 1 && day <= longest ? { kind: "year-day", month: inMonth, day } : null;
};

const nthWeekdayRule = (words: string): NthWeekday | null => {
  const match =
    /^(monthly|every month|yearly|every year) on (?:(the day|(\d{1,3}) days?) after )?the ([a-z0-9]+) ([a-z]+)(?: of ([a-z]+))?$/.exec(
      words,
    );
  if (match === null) return null;
  const [, every, offset, days, ordinal, dayName, monthName] = match;
  const nth = ORDINALS[ordinal!];
  const day = weekday(dayName!);
  const inMonth = monthName === undefined ? null : month(monthName);
  const yearly = every!.includes("year");
  if (nth === undefined || day === -1 || inMonth === 0 || yearly !== (inMonth !== null))
    return null;
  const after = offset === undefined ? 0 : Number(days ?? 1);
  return { kind: "nth-weekday", nth, weekday: day, month: inMonth, after };
};

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

  const yearDay = yearDayRule(words);
  if (yearDay !== null) return { rule: yearDay };

  const nthWeekday = nthWeekdayRule(words);
  if (nthWeekday !== null) return { rule: nthWeekday };

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

const onDay = (year: number, monthIndex: number, day: number): Day =>
  fromUtc(new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex)))));

/** The day an nth-weekday rule names in a month, or null when that month has no such weekday. */
const nthIn = (rule: NthWeekday, year: number, monthIndex: number): Day | null => {
  const length = daysInMonth(year, monthIndex);
  const first = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const firstMatch = 1 + ((rule.weekday - first + 7) % 7);
  const day =
    rule.nth === -1
      ? firstMatch + 7 * Math.floor((length - firstMatch) / 7)
      : firstMatch + 7 * (rule.nth - 1);
  return day > length ? null : addDays(onDay(year, monthIndex, day), rule.after);
};

/** The first day on or after `from` that the calendar rule names. */
const onOrAfter = (rule: Calendar, from: Day): Day => {
  switch (rule.kind) {
    case "weekdays": {
      const weekday = toUtc(from).getUTCDay();
      return addDays(from, Math.min(...rule.days.map((day) => (day - weekday + 7) % 7)));
    }
    case "month-day": {
      const thisMonth = addMonths(from, 0, rule.day);
      return thisMonth >= from ? thisMonth : addMonths(from, 1, rule.day);
    }
    case "year-day": {
      const year = toUtc(from).getUTCFullYear();
      const thisYear = onDay(year, rule.month - 1, rule.day);
      return thisYear >= from ? thisYear : onDay(year + 1, rule.month - 1, rule.day);
    }
    case "nth-weekday": {
      const date = toUtc(from);
      const step = rule.month === null ? 1 : 12;
      const inMonth = rule.month === null ? date.getUTCMonth() : rule.month - 1;
      for (let index = date.getUTCFullYear() * 12 + inMonth - step; ; index += step) {
        const day = nthIn(rule, Math.floor(index / 12), index % 12);
        if (day !== null && day >= from) return day;
      }
    }
  }
};

/**
 * The due day after a calendar rule's task, due on `due`, was done on `done`. Done in the due's
 * own period, early or late, it is due on the first matching day after both; done in an earlier
 * period (logged history), the due stays.
 */
const dueAfter = (rule: Calendar, due: Day | null, done: Day): Day => {
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
