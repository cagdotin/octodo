/**
 * `log.jsonl`, the history of a recurring task or a days-since counter: one line per time the
 * thing happened, `{"at":"2026-10-25T09:12:00Z","event":"done"}` (decisions 0009, 0019).
 * Occurrences are whole minutes, and the log holds each minute once, so logging one again changes
 * nothing. Every event counts as an occurrence for every kind that reads the log, so a task whose
 * `type` changes between them keeps its history.
 */
import { InvalidRequest } from "@octodo/contract";
import type { PluginWorkspace } from "@octodo/engine";
import { DateTime, Effect } from "effect";

export const LOG = "log.jsonl";

/** What a line says happened: a recurring task was done, a counter was reset. */
export const EVENTS = ["done", "reset"] as const;
export type LogEvent = (typeof EVENTS)[number];

/** A line the log could not use, by its number from 1. */
export interface BadLine {
  readonly line: number;
  readonly reason: string;
}

export interface Log {
  /** Every occurrence, oldest first, each once. */
  readonly occurrences: ReadonlyArray<string>;
  readonly bad: ReadonlyArray<BadLine>;
}

/** The instant as the log writes it: UTC, to the minute. */
export const toMinute = (instant: Date): string => `${instant.toISOString().slice(0, 16)}:00Z`;

const lines = (text: string) => text.split("\n").map((line) => line.trim());

const isEvent = (event: unknown): event is LogEvent => EVENTS.includes(event as LogEvent);

/** The minute a line logs, or why it logs none. */
const readLine = (line: string): { readonly at: string } | { readonly reason: string } => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { reason: "is not JSON" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { reason: "is not an object" };
  const { at, event } = value as { readonly at?: unknown; readonly event?: unknown };
  if (!isEvent(event))
    return {
      reason:
        event === undefined
          ? "has no event"
          : `has the event ${JSON.stringify(event)}, not one of ${EVENTS.map((known) => `"${known}"`).join(" or ")}`,
    };
  if (typeof at !== "string" || Number.isNaN(Date.parse(at)))
    return {
      reason:
        at === undefined
          ? "has no time"
          : `has the time ${JSON.stringify(at)}, which is not a date and time`,
    };
  return { at: toMinute(new Date(at)) };
};

export const readLog = (text: string): Log => {
  const occurrences = new Set<string>();
  const bad: Array<BadLine> = [];
  for (const [index, line] of lines(text).entries()) {
    if (line === "") continue;
    const read = readLine(line);
    if ("at" in read) occurrences.add(read.at);
    else bad.push({ line: index + 1, reason: read.reason });
  }
  return { occurrences: [...occurrences].toSorted(), bad };
};

/** The log with the minute `at` in it, as `event`; the same text when it already has the minute. */
export const withOccurrence = (text: string | null, at: string, event: LogEvent): string => {
  const current = text ?? "";
  if (readLog(current).occurrences.includes(at)) return current;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  return `${current}${separator}${JSON.stringify({ at, event })}\n`;
};

/** The log without the lines that log the minute `at`; every other line stays as it was. */
export const withoutOccurrence = (text: string, at: string): string =>
  text
    .split("\n")
    .filter((line) => {
      const read = line.trim() === "" ? null : readLine(line.trim());
      return read === null || !("at" in read) || read.at !== at;
    })
    .join("\n");

/** The minute of `at` (a day means its midday here), refusing a time still to come. */
export const occurrenceAt = (at: string | undefined) =>
  Effect.gen(function* () {
    const now = new Date(DateTime.toEpochMillis(yield* DateTime.now));
    const when = at === undefined ? now : new Date(at.length === 10 ? `${at}T12:00` : at);
    if (when.getTime() > now.getTime() + 60_000)
      return yield* new InvalidRequest({ message: `${at} has not happened yet` });
    return toMinute(when);
  });

/** Logs `event` at `at` (now when omitted) in the task's log. */
export const logOccurrence = (
  ws: PluginWorkspace,
  id: string,
  at: string | undefined,
  event: LogEvent,
) =>
  Effect.flatMap(occurrenceAt(at), (minute) =>
    ws.editOfKind(id, { files: { [LOG]: (text) => withOccurrence(text, minute, event) } }),
  );

/** Takes the occurrence at `at` out of the task's log, refusing a time the log does not have. */
export const removeOccurrence = (ws: PluginWorkspace, id: string, at: string, noun: string) =>
  Effect.gen(function* () {
    const time = new Date(at);
    if (Number.isNaN(time.getTime()))
      return yield* new InvalidRequest({ message: `${at} is not a date and time` });
    const minute = toMinute(time);
    const text = (yield* ws.filesOfKind(id)).get(LOG) ?? "";
    if (!readLog(text).occurrences.includes(minute))
      return yield* new InvalidRequest({ message: `${id} has no ${noun} at ${minute}` });
    return yield* ws.editOfKind(id, {
      files: { [LOG]: (current) => withoutOccurrence(current ?? "", minute) },
    });
  });

/** Every occurrence in the task's log, newest first. */
export const listOccurrences = (ws: PluginWorkspace, id: string) =>
  Effect.map(ws.filesOfKind(id), (texts) =>
    readLog(texts.get(LOG) ?? "")
      .occurrences.toReversed()
      .map((at) => ({ at })),
  );

/** One diagnostic-ready problem per line the log could not use. */
export const badLines = (log: Log) =>
  log.bad.map(({ line, reason }) => ({
    problem: "bad-line" as const,
    file: LOG,
    detail: `Line ${line} ${reason}`,
  }));
