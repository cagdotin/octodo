import { InvalidRequest } from "@octodo/contract";
import { definePlugin, type KindProblem } from "@octodo/engine";
import { Effect } from "effect";
import {
  badLines,
  kindLog,
  listOccurrences,
  LOG,
  logOccurrence,
  readLog,
  removeOccurrence,
  withOccurrence,
} from "../log.ts";
import { readDay } from "../day.ts";
import { localDay, nextDue, parseRule, type Rule } from "./rule.ts";
import { recurringShared, type RecurringFields } from "./shared.ts";

type Problem = KindProblem<keyof typeof recurringShared.problems>;

const RECENT = 10;

const dayOf = (instant: string) => localDay(instant) ?? [];

const checkRule = (repeat: string) => {
  const read = parseRule(repeat);
  return "error" in read
    ? Effect.fail(new InvalidRequest({ message: read.error }))
    : Effect.succeed(repeat.trim());
};

/** The keys a create or a rule change writes, refusing a rule or a start day that does not read. */
const ruleKeys = (repeat: string, start: string | undefined) =>
  Effect.gen(function* () {
    const rule = yield* checkRule(repeat);
    if (start === undefined) return { repeat: rule };
    const read = readDay(start);
    if ("error" in read) return yield* new InvalidRequest({ message: read.error });
    return { repeat: rule, start: read.day };
  });

/** The day in `start`, or the day it was created when it has none or a broken one. */
const readStart = (
  start: unknown,
  created: string | null,
): { readonly start: string | null; readonly problem?: Problem } => {
  const fallback = created === null ? null : localDay(created);
  if (start === undefined) return { start: fallback };
  const read = readDay(start);
  if ("day" in read) return { start: read.day };
  return { start: fallback, problem: { problem: "bad-start", field: "start", detail: read.error } };
};

/** The rule in `repeat`, or the problem with it. */
const readRule = (repeat: unknown): { readonly rule: Rule | null; readonly problem?: Problem } => {
  const problem = (detail: string): { rule: null; problem: Problem } => ({
    rule: null,
    problem: { problem: "bad-repeat", field: "repeat", detail },
  });
  if (repeat === undefined) return problem("The task has no repeat rule");
  if (typeof repeat !== "string")
    return problem(`The repeat ${JSON.stringify(repeat)} is not text`);
  const read = parseRule(repeat);
  return "error" in read ? problem(read.error) : { rule: read.rule };
};

export const recurring = definePlugin(recurringShared, {
  read: ({ entry, keys, files }) => {
    const { rule, problem } = readRule(keys["repeat"]);
    const { start, problem: startProblem } = readStart(keys["start"], entry.created);
    const log = readLog(files.get(LOG) ?? "");
    const problems: Array<Problem> = [
      ...(problem === undefined ? [] : [problem]),
      ...(startProblem === undefined ? [] : [startProblem]),
      ...badLines(log),
    ];
    const last = log.occurrences.at(-1) ?? null;
    const fields: RecurringFields = {
      repeat: typeof keys["repeat"] === "string" ? keys["repeat"] : null,
      start,
      next: rule === null ? null : nextDue(rule, log.occurrences.flatMap(dayOf), start),
      last,
      count: log.occurrences.length,
      recent: log.occurrences.slice(-RECENT).toReversed(),
    };
    return { fields, problems };
  },
  handlers: {
    create_recurring: (ws, { repeat, start, ...input }) =>
      Effect.flatMap(ruleKeys(repeat, start), (keys) => ws.createOfKind(input, keys)),
    set_repeat: (ws, { id, repeat, start }) =>
      Effect.flatMap(ruleKeys(repeat, start), (keys) => ws.editOfKind(id, { keys })),
    log_occurrence: (ws, { id, at }) => logOccurrence(kindLog(ws, id), at, "done"),
    remove_occurrence: (ws, { id, at }) => removeOccurrence(kindLog(ws, id), at, "occurrence"),
    list_occurrences: (ws, { id }) => listOccurrences(kindLog(ws, id)),
  },
  complete: (at) => ({ files: { [LOG]: (text) => withOccurrence(text, at, "done") } }),
});
