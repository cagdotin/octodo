import { InvalidRequest, type Entry } from "@octodo/contract";
import { localDay } from "@octodo/contract/rules";
import { definePlugin, type KindProblem, type PluginWorkspace } from "@octodo/engine";
import { Effect } from "effect";
import {
  badLines,
  listOccurrences,
  LOG,
  logOccurrence,
  readLog,
  removeOccurrence,
  sectionLog,
} from "../log.ts";
import { COUNTER_TYPES, countOf, readDay, type CounterFields, type CounterType } from "./count.ts";
import { countersShared, type Counter } from "./shared.ts";

const NONE: CounterFields = { type: null, since: null, last: null, date: null };

const isType = (type: unknown): type is CounterType => COUNTER_TYPES.includes(type as CounterType);

/** A counter as its operations give it, counted from today where the engine runs. */
const counted = (entry: Entry): Counter => {
  const fields = entry.fields as unknown as CounterFields;
  return { ...entry, fields, count: countOf(fields, localDay()) };
};

const checkDate = (date: string) => {
  const read = readDay(date);
  return "error" in read
    ? Effect.fail(new InvalidRequest({ message: read.error }))
    : Effect.succeed(read.day);
};

/** The counter `id`, refusing one whose type is not `type`. */
const ofType = (ws: PluginWorkspace, id: string, type: CounterType, doing: string) =>
  Effect.flatMap(ws.getInSection(id), (entry) =>
    (entry.fields as unknown as CounterFields).type === type
      ? Effect.succeed(entry)
      : Effect.fail(new InvalidRequest({ message: `${id} is not a ${type} counter, so ${doing}` })),
  );

export const counters = definePlugin(countersShared, {
  read: ({ entry, keys, files }) => {
    const problems: Array<KindProblem<"bad-type" | "bad-date" | "bad-line">> = [];
    const { type, date } = keys;
    if (!isType(type)) {
      problems.push({
        problem: "bad-type",
        field: "type",
        detail: `The type ${JSON.stringify(type)} is not since or yearly`,
      });
      return { fields: NONE, problems };
    }
    if (type === "yearly") {
      const read = date === undefined ? { error: "The counter has no date" } : readDay(date);
      if ("error" in read)
        problems.push({ problem: "bad-date", field: "date", detail: read.error });
      return { fields: { ...NONE, type, date: "day" in read ? read.day : null }, problems };
    }
    const log = readLog(files.get(LOG) ?? "");
    const last = log.occurrences.at(-1) ?? null;
    return {
      fields: { ...NONE, type, since: last ?? entry.created, last },
      problems: badLines(log),
    };
  },
  handlers: {
    create_counter: (ws, { type, date, title, body }) =>
      Effect.gen(function* () {
        if (type === "since" && date !== undefined)
          return yield* new InvalidRequest({ message: "A since counter has no date" });
        if (type === "yearly" && date === undefined)
          return yield* new InvalidRequest({ message: "A yearly counter needs its first day" });
        const keys = date === undefined ? { type } : { type, date: yield* checkDate(date) };
        return counted(yield* ws.createInSection({ title, body }, keys));
      }),
    update_counter: (ws, { id, title, body, date }) =>
      Effect.gen(function* () {
        if (date !== undefined) yield* ofType(ws, id, "yearly", "it has no date");
        const keys = date === undefined ? undefined : { date: yield* checkDate(date) };
        return counted(
          yield* ws.editInSection(id, { title, body, ...(keys === undefined ? {} : { keys }) }),
        );
      }),
    reset_counter: (ws, { id, at }) =>
      Effect.andThen(
        ofType(ws, id, "since", "it does not reset"),
        Effect.map(logOccurrence(sectionLog(ws, id), at, "reset"), counted),
      ),
    remove_reset: (ws, { id, at }) =>
      Effect.map(removeOccurrence(sectionLog(ws, id), at, "reset"), counted),
    list_resets: (ws, { id }) => listOccurrences(sectionLog(ws, id)),
    delete_counter: (ws, { id }) => Effect.as(ws.deleteInSection(id), { deleted: id }),
    list_counters: (ws) => Effect.map(ws.entriesInSection, (entries) => entries.map(counted)),
  },
});
