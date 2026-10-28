import { InvalidRequest } from "@octodo/contract";
import { definePlugin, type KindProblem } from "@octodo/engine";
import { Effect } from "effect";
import {
  badLines,
  listOccurrences,
  LOG,
  logOccurrence,
  readLog,
  removeOccurrence,
  withOccurrence,
} from "../log.ts";
import { localDay, nextDue, parseRule, type Rule } from "./rule.ts";
import { recurringShared, type RecurringFields } from "./shared.ts";

type Problem = KindProblem<keyof typeof recurringShared.problems>;

const RECENT = 10;

const checkRule = (repeat: string) => {
  const read = parseRule(repeat);
  return "error" in read
    ? Effect.fail(new InvalidRequest({ message: read.error }))
    : Effect.succeed(repeat.trim());
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
  read: ({ task, keys, files }) => {
    const { rule, problem } = readRule(keys["repeat"]);
    const log = readLog(files.get(LOG) ?? "");
    const problems: Array<Problem> = [
      ...(problem === undefined ? [] : [problem]),
      ...badLines(log),
    ];
    const last = log.occurrences.at(-1) ?? null;
    const start = task.created === null ? null : localDay(task.created);
    const fields: RecurringFields = {
      repeat: typeof keys["repeat"] === "string" ? keys["repeat"] : null,
      next: rule === null ? null : nextDue(rule, last === null ? null : localDay(last), start),
      last,
      count: log.occurrences.length,
      recent: log.occurrences.slice(-RECENT).toReversed(),
    };
    return { fields, problems };
  },
  handlers: {
    create_recurring: (ws, { repeat, ...input }) =>
      Effect.flatMap(checkRule(repeat), (rule) => ws.createOfKind(input, { repeat: rule })),
    set_repeat: (ws, { id, repeat }) =>
      Effect.flatMap(checkRule(repeat), (rule) => ws.editOfKind(id, { keys: { repeat: rule } })),
    log_occurrence: (ws, { id, at }) => logOccurrence(ws, id, at, "done"),
    remove_occurrence: (ws, { id, at }) => removeOccurrence(ws, id, at, "occurrence"),
    list_occurrences: (ws, { id }) => listOccurrences(ws, id),
  },
  complete: (at) => ({ files: { [LOG]: (text) => withOccurrence(text, at, "done") } }),
});
