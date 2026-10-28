import { definePlugin } from "@octodo/engine";
import {
  badLines,
  listOccurrences,
  LOG,
  logOccurrence,
  readLog,
  removeOccurrence,
} from "../log.ts";
import { daysBetween } from "./days.ts";
import { counterShared, type CounterFields } from "./shared.ts";

const RECENT = 10;

/** The longest run between two consecutive starts, in calendar days. */
const longestRun = (starts: ReadonlyArray<string>) =>
  Math.max(
    0,
    ...starts.slice(1).map((end, index) => daysBetween(starts[index]!, new Date(end)) ?? 0),
  );

/** A counter starts when it was created, or at its first reset when that is earlier. */
const runStarts = (created: string | null, resets: ReadonlyArray<string>) => {
  const first = resets[0];
  const startsAtCreation =
    created !== null &&
    !Number.isNaN(Date.parse(created)) &&
    (first === undefined || Date.parse(created) < Date.parse(first));
  return startsAtCreation ? [created, ...resets] : resets;
};

export const counter = definePlugin(counterShared, {
  read: ({ entry, files }) => {
    const log = readLog(files.get(LOG) ?? "");
    const resets = log.occurrences;
    const starts = runStarts(entry.created, resets);
    const fields: CounterFields = {
      since: starts.at(-1) ?? null,
      last: resets.at(-1) ?? null,
      resets: resets.length,
      longest: longestRun(starts),
      recent: resets.slice(-RECENT).toReversed(),
    };
    return { fields, problems: badLines(log) };
  },
  handlers: {
    create_counter: (ws, input) => ws.createOfKind(input, {}),
    reset_counter: (ws, { id, at }) => logOccurrence(ws, id, at, "reset"),
    remove_reset: (ws, { id, at }) => removeOccurrence(ws, id, at, "reset"),
    list_resets: (ws, { id }) => listOccurrences(ws, id),
  },
});
