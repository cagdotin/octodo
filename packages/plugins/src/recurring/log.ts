/**
 * `log.jsonl`: one line per time the task was done, `{"at":"2026-10-25T09:12:00Z","event":"done"}`
 * (decision 0009). Occurrences are whole minutes, and the log holds each minute once, so logging
 * one again changes nothing.
 */

export const LOG = "log.jsonl";

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
  if (event !== "done")
    return {
      reason:
        event === undefined ? "has no event" : `has the event ${JSON.stringify(event)}, not "done"`,
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

/** The log with the minute `at` in it; the same text when it already has it. */
export const withOccurrence = (text: string | null, at: string): string => {
  const current = text ?? "";
  if (readLog(current).occurrences.includes(at)) return current;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  return `${current}${separator}${JSON.stringify({ at, event: "done" })}\n`;
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
