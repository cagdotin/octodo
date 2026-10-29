import type { List, Priority } from "@octodo/contract";
import { casual, type Component, type ParsedResult, type Refiner } from "chrono-node/en";
import { addDays, format, isValid, parseISO } from "date-fns";

/** What one token in the text sets on the new task. */
export type QuickAddToken =
  | { kind: "list"; list: string }
  | { kind: "tag"; tag: string }
  | { kind: "priority"; priority: Priority }
  | { kind: "due"; due: string };

/** The span `[from, to)` of the text a token matched. */
export interface QuickAddRange {
  from: number;
  to: number;
  token: QuickAddToken;
}

export interface QuickAddFields {
  list?: string;
  tags: Array<string>;
  priority?: Priority;
  /** `yyyy-MM-dd`, the frontmatter form. */
  due?: string;
}

export interface QuickAdd {
  /** The text without its tokens, whitespace collapsed. */
  title: string;
  fields: QuickAddFields;
  /** Every matched token in text order; a later token of the same kind wins the field. */
  ranges: ReadonlyArray<QuickAddRange>;
}

export interface QuickAddContext {
  lists: ReadonlyArray<Pick<List, "id">>;
  now: Date;
  /** Token texts (lowercase) the user turned back into plain title text by clicking their chip. */
  plain?: ReadonlySet<string>;
  /** Whether dates are tokens; false leaves them in the title, for a task that takes no due. */
  dates?: boolean;
}

export const PRIORITY_WORDS: Readonly<Record<string, Priority>> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  med: "medium",
  low: "low",
  none: "none",
  "1": "urgent",
  "2": "high",
  "3": "medium",
  "4": "low",
};

const dayKey = (date: Date) => format(date, "yyyy-MM-dd");

const dueWord = (value: string, now: Date): string | undefined => {
  const lower = value.toLowerCase();
  if (lower === "today") return dayKey(now);
  if (lower === "tomorrow" || lower === "tmr") return dayKey(addDays(now, 1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value))) return value;
  const [natural] = naturalDates.parse(value, now, { forwardDate: true });
  return natural?.index === 0 && natural.text.length === value.length
    ? dayKey(natural.start.date())
    : undefined;
};

/** `/garden/seeds` by its id, or `/seeds` when exactly one list ends in that slug. */
const resolveList = (name: string, lists: QuickAddContext["lists"]): string | undefined => {
  const lower = name.toLowerCase();
  const exact = lists.find((list) => list.id.toLowerCase() === lower);
  if (exact) return exact.id;
  const leaves = lists.filter((list) => list.id.toLowerCase().split("/").at(-1) === lower);
  return leaves.length === 1 ? leaves[0]!.id : undefined;
};

const wordToken = (word: string, context: QuickAddContext): QuickAddToken | undefined => {
  const sigil = word[0];
  const rest = word.slice(1);
  if (sigil === "!") {
    const priority = PRIORITY_WORDS[rest.toLowerCase()];
    return priority === undefined ? undefined : { kind: "priority", priority };
  }
  if (sigil === "#" && /^[\w/-]+$/.test(rest)) return { kind: "tag", tag: rest };
  if (sigil === "/" && /^[\w/-]+$/.test(rest)) {
    const list = resolveList(rest, context.lists);
    return list === undefined ? undefined : { kind: "list", list };
  }
  const due = /^due:(\S+)$/i.exec(word)?.[1];
  const date = due === undefined ? undefined : dueWord(due, context.now);
  return date === undefined ? undefined : { kind: "due", due: date };
};

/** chrono reads a bare "at 3" as 3 am; people adding a task mean the afternoon. */
const preferAfternoon: Refiner = {
  refine: (_context, results) => {
    for (const { start } of results) {
      const hour = start.get("hour");
      if (hour !== null && hour >= 1 && hour <= 7 && !start.isCertain("meridiem")) {
        start.assign("hour", hour + 12);
        start.assign("meridiem", 1);
      }
    }
    return results;
  },
};
const naturalDates = casual.clone();
naturalDates.refiners.unshift(preferAfternoon);

/** "every monday", "each other week at 3": recurrence (OCT-4), which chrono reads as one date. */
const RECURRENCE_LEAD =
  /\b(?:every|each)(?:\s+(?:other|and|day|days|week|weeks|month|months|year|years|weekdays?|first|second|third|fourth|last|\d+(?:st|nd|rd|th)?|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|sat\w*|sun\w*))*\s+$/i;

const PINNING: ReadonlyArray<Component> = ["day", "weekday", "hour"];

/**
 * A date chrono found that reads as one in a title. Bare short words ("sat", "sun", "now") and
 * bare month names ("march") are ordinary words far more often than dates.
 */
const isTitleDate = (result: ParsedResult, text: string) => {
  const oneWord = /^\p{L}+\.?$/u.test(result.text);
  if (oneWord && result.text.length <= 3) return false;
  if (oneWord && !PINNING.some((unit) => result.start.isCertain(unit))) return false;
  return !RECURRENCE_LEAD.test(text.slice(0, result.index));
};

/** The first natural date in the text outside `taken`, e.g. "tomorrow 5pm" or "next friday". */
const naturalDue = (
  text: string,
  taken: ReadonlyArray<QuickAddRange>,
  context: QuickAddContext,
): QuickAddRange | undefined => {
  let masked = text;
  for (const { from, to } of taken) {
    masked = masked.slice(0, from) + " ".repeat(to - from) + masked.slice(to);
  }
  const found = naturalDates
    .parse(masked, context.now, { forwardDate: true })
    .find(
      (result) => isTitleDate(result, masked) && !context.plain?.has(result.text.toLowerCase()),
    );
  return found === undefined
    ? undefined
    : {
        from: found.index,
        to: found.index + found.text.length,
        token: { kind: "due", due: dayKey(found.start.date()) },
      };
};

const fieldsOf = (ranges: ReadonlyArray<QuickAddRange>): QuickAddFields => {
  const fields: QuickAddFields = { tags: [] };
  const tags = new Set<string>();
  for (const { token } of ranges) {
    if (token.kind === "list") fields.list = token.list;
    if (token.kind === "priority") fields.priority = token.priority;
    if (token.kind === "due") fields.due = token.due;
    if (token.kind === "tag") tags.add(token.tag);
  }
  return { ...fields, tags: [...tags] };
};

/** The text with the given ranges cut out and whitespace collapsed. */
export const withoutRanges = (text: string, ranges: ReadonlyArray<QuickAddRange>) => {
  let rest = text;
  for (const { from, to } of [...ranges].sort((a, b) => b.from - a.from)) {
    rest = rest.slice(0, from) + " " + rest.slice(to);
  }
  return rest.replace(/\s+/g, " ").trim();
};

/**
 * Parses quick-add text. Tokens: `/list` (id or unique last slug), `#tag`, `!priority`
 * (`!high`, `!1`-`!4`), `due:<day>`, and, when there is no `due:`, the first natural date
 * ("tomorrow 5pm", "next friday"). Everything else is the title.
 */
export const parseQuickAdd = (text: string, context: QuickAddContext): QuickAdd => {
  const ranges: Array<QuickAddRange> = [];
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0];
    if (context.plain?.has(word.toLowerCase())) continue;
    const token = wordToken(word, context);
    if (token && (token.kind !== "due" || context.dates !== false))
      ranges.push({ from: match.index, to: match.index + word.length, token });
  }
  if (context.dates !== false && !ranges.some((range) => range.token.kind === "due")) {
    const natural = naturalDue(text, ranges, context);
    if (natural) ranges.push(natural);
    ranges.sort((a, b) => a.from - b.from);
  }
  return { title: withoutRanges(text, ranges), fields: fieldsOf(ranges), ranges };
};
