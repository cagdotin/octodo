import { InvalidRequest } from "@octodo/contract";
import { definePlugin, type KindProblem } from "@octodo/engine";
import { DateTime, Effect } from "effect";
import { LOG, readLog, toMinute, withOccurrence, withoutOccurrence } from "./log.ts";
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

/** The minute of `at` (a day means its midday here), refusing a time still to come. */
const occurrenceAt = (at: string | undefined) =>
  Effect.gen(function* () {
    const now = new Date(DateTime.toEpochMillis(yield* DateTime.now));
    const when = at === undefined ? now : new Date(at.length === 10 ? `${at}T12:00` : at);
    if (when.getTime() > now.getTime() + 60_000)
      return yield* new InvalidRequest({ message: `${at} has not happened yet` });
    return toMinute(when);
  });

export const recurring = definePlugin(recurringShared, {
  read: ({ task, keys, files }) => {
    const { rule, problem } = readRule(keys["repeat"]);
    const log = readLog(files.get(LOG) ?? "");
    const problems: Array<Problem> = [
      ...(problem === undefined ? [] : [problem]),
      ...log.bad.map(({ line, reason }): Problem => ({
        problem: "bad-line",
        file: LOG,
        detail: `Line ${line} ${reason}`,
      })),
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
    log_occurrence: (ws, { id, at }) =>
      Effect.flatMap(occurrenceAt(at), (minute) =>
        ws.editOfKind(id, { files: { [LOG]: (text) => withOccurrence(text, minute) } }),
      ),
    remove_occurrence: (ws, { id, at }) =>
      Effect.gen(function* () {
        const time = new Date(at);
        if (Number.isNaN(time.getTime()))
          return yield* new InvalidRequest({ message: `${at} is not a date and time` });
        const minute = toMinute(time);
        const text = (yield* ws.filesOfKind(id)).get(LOG) ?? "";
        if (!readLog(text).occurrences.includes(minute))
          return yield* new InvalidRequest({ message: `${id} has no occurrence at ${minute}` });
        return yield* ws.editOfKind(id, {
          files: { [LOG]: (current) => withoutOccurrence(current ?? "", minute) },
        });
      }),
    list_occurrences: (ws, { id }) =>
      Effect.map(ws.filesOfKind(id), (texts) =>
        readLog(texts.get(LOG) ?? "")
          .occurrences.toReversed()
          .map((at) => ({ at })),
      ),
  },
  complete: (at) => ({ files: { [LOG]: (text) => withOccurrence(text, at) } }),
});
