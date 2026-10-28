import { DueDate, Entry, EntryNotFound, InvalidRequest } from "@octodo/contract";
import { cli, inWorkspace } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { localDay } from "@octodo/contract/rules";
import { Schema } from "effect";
import { COUNTER_TYPES, counterDay, countText, type CounterFields as Fields } from "./count.ts";

const workspace = Schema.optionalKey(Schema.String).annotate({
  description: "Registered workspace id or absolute path. Omit to use the current project.",
});

const id = Schema.String.annotate({
  description: "Counter id, e.g. HM-42",
  ...cli({ positional: true }),
});

const DATE =
  "A yearly counter's first day, YYYY-MM-DD, such as a birthday 1961-06-14. It comes back on that day every year; February 29 comes back on the 28th in other years.";

const date = Schema.String.annotate({
  description: DATE,
  ...cli({ alias: "d" }),
});

export const CounterType = Schema.Literals(COUNTER_TYPES);

export const CounterFields = Schema.Struct({
  type: Schema.NullOr(CounterType),
  since: Schema.NullOr(Schema.String),
  last: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
});

export const Count = Schema.Union([
  Schema.Struct({ daysSince: Schema.Int }),
  Schema.Struct({ next: Schema.String, daysUntil: Schema.Int, years: Schema.Int }),
]);

/**
 * A counter as its operations give it: an entry of `.octodo/counters/`, with `count` from today
 * where the operation ran. `fields` stays absolute; clients count from their own today.
 */
export const Counter = Schema.Struct({
  ...Entry.fields,
  fields: CounterFields,
  count: Schema.NullOr(Count).annotate({
    description:
      "Today's count: daysSince for a since counter; next, daysUntil and the years it marks on next for a yearly one. Null when its date or type cannot be read.",
  }),
});
export type Counter = typeof Counter.Type;

/** One time a since counter was reset: UTC, to the minute. */
export const Reset = Schema.Struct({ at: Schema.String });

const at = Schema.optionalKey(DueDate).annotate({
  description:
    "When it happened: YYYY-MM-DD (its midday, or now when that is still to come today) or YYYY-MM-DDTHH:mm; now if omitted",
});

const errors = inWorkspace(InvalidRequest, EntryNotFound);

/**
 * Counters, a section of their own in `.octodo/counters/` (decision 0027): `type: since` counts
 * the days since its last reset, which `log.jsonl` keeps (0019); `type: yearly` comes back every
 * year on its `date` (0020).
 */
export const countersShared = {
  id: "counters",
  name: "Counters",
  description:
    "Count the days since something last happened, or to a date that comes back every year, such as a birthday.",
  section: { marker: "counter.md" },
  keys: Schema.Struct({ type: CounterType, date: Schema.String }),
  files: ["log.jsonl"],
  fields: CounterFields,
  operations: {
    create_counter: {
      description:
        "Create a counter. A since counter counts the days since something last happened, from now; reset_counter records each time it happens (with at for an earlier time). A yearly counter comes back every year on date, the day it first happened, and shows in list_tasks with due_by on its next occurrence.",
      readonly: false,
      destructive: false,
      input: Schema.Struct({
        workspace,
        title: Schema.NonEmptyString.annotate(cli({ positional: true })),
        type: CounterType.annotate({ description: "since or yearly", ...cli({ alias: "t" }) }),
        date: Schema.optionalKey(
          date.annotate({
            description: `${DATE} Required for a yearly counter, refused for a since one.`,
          }),
        ),
        body: Schema.optionalKey(Schema.String),
      }),
      success: Counter,
      error: errors,
      http: { method: "POST", path: "/workspaces/:workspace/counters" },
      cli: {
        command: ["counters", "create"],
        description: "Create a since or yearly counter",
        examples: [
          {
            command: 'octo counters create "Days since I last smoked" --type since',
            description: "A counter that starts now",
          },
          {
            command: 'octo counters create "Mum\'s birthday" --type yearly --date 1961-06-14',
            description: "A birthday that comes back every June 14",
          },
        ],
      },
    },
    update_counter: {
      description:
        "Change a counter's title, body or, for a yearly counter, the day it first happened. Its type stays.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({
        workspace,
        id,
        title: Schema.optionalKey(Schema.NonEmptyString),
        body: Schema.optionalKey(Schema.String),
        date: Schema.optionalKey(date),
      }),
      success: Counter,
      error: errors,
      http: { method: "PATCH", path: "/workspaces/:workspace/counters/:id" },
      cli: { command: ["counters", "update"], description: "Change a counter" },
    },
    reset_counter: {
      description:
        "Record that a since counter's thing happened, now or at an earlier time: the count starts again from the latest reset. Resetting at a minute it already has changes nothing.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({ workspace, id, at }),
      success: Counter,
      error: errors,
      http: { method: "POST", path: "/workspaces/:workspace/counters/:id/resets" },
      cli: {
        command: ["counters", "reset"],
        description: "Reset a since counter, now or at an earlier time",
        examples: [
          {
            command: "octo counters reset HM-4 --at 2026-10-16",
            description: "It last happened on the 16th",
          },
        ],
      },
    },
    remove_reset: {
      description: "Take back one reset of a since counter, by its time as list_resets gives it.",
      readonly: false,
      destructive: true,
      input: Schema.Struct({
        workspace,
        id,
        at: Schema.String.annotate({
          description: "The reset's time, e.g. 2026-10-25T09:12:00Z",
          ...cli({ positional: true }),
        }),
      }),
      success: Counter,
      error: errors,
      http: { method: "DELETE", path: "/workspaces/:workspace/counters/:id/resets/:at" },
      cli: { command: ["counters", "unreset"], description: "Take back one reset" },
    },
    list_resets: {
      description: "List every time a since counter was reset, newest first.",
      readonly: true,
      input: Schema.Struct({ workspace, id }),
      success: Schema.Array(Reset),
      error: errors,
      http: { method: "GET", path: "/workspaces/:workspace/counters/:id/resets" },
      cli: { command: ["counters", "history"], description: "List when a counter was reset" },
    },
    delete_counter: {
      description:
        "Delete a counter: its folder, its history and its attachments. Tasks' links to it go too; mentions in bodies stay as text.",
      readonly: false,
      destructive: true,
      idempotent: false,
      input: Schema.Struct({ workspace, id }),
      success: Schema.Struct({ deleted: Schema.String }),
      error: errors,
      http: { method: "DELETE", path: "/workspaces/:workspace/counters/:id" },
      cli: { command: ["counters", "delete"], description: "Delete a counter" },
    },
    list_counters: {
      description:
        "List the counters in their order, each with its body, its fields, the tasks and entries that mention it, and today's count.",
      readonly: true,
      input: Schema.Struct({ workspace }),
      success: Schema.Array(Counter),
      error: inWorkspace(),
      http: { method: "GET", path: "/workspaces/:workspace/counters" },
      cli: { command: ["counters", "list"], aliases: ["ls"], description: "List the counters" },
    },
  },
  problems: {
    "bad-type": "Until it is fixed the counter counts nothing; its type must be since or yearly",
    "bad-date": "Until it is fixed the counter has no next occurrence; set one with update_counter",
    "bad-line": "That line does not count as a reset",
  },
  label: (fields: Fields) => countText(fields, localDay()),
  day: counterDay,
} satisfies PluginShared;
