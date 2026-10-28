import { CreateTaskInput, DueDate, InvalidRequest, Task, TaskNotFound } from "@octodo/contract";
import { cli, inWorkspace } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { Schema } from "effect";
import { counted, daysText, localDay } from "./days.ts";

const workspace = Schema.optionalKey(Schema.String).annotate({
  description: "Registered workspace id or absolute path. Omit to use the current project.",
});

const id = Schema.String.annotate({
  description: "Counter task id, e.g. HM-42",
  ...cli({ positional: true }),
});

/** One time the counter was reset: UTC, to the minute. */
export const Reset = Schema.Struct({ at: Schema.String });

export const CounterFields = Schema.Struct({
  /** When the current run started: the last reset, or when the counter started if never reset. */
  since: Schema.NullOr(Schema.String),
  /** When it was last reset, or null if never. */
  last: Schema.NullOr(Schema.String),
  /** How many times it was reset. */
  resets: Schema.Int,
  /** The longest run that a reset ended, in calendar days; 0 when none has ended. */
  longest: Schema.Int,
  /** The latest resets, newest first, up to ten; list_resets has them all. */
  recent: Schema.Array(Schema.String),
});
export type CounterFields = typeof CounterFields.Encoded;

const { title, due: _due, ...createFields } = CreateTaskInput.fields;

/**
 * Counts the days since something last happened: `type: counter`, its resets in `log.jsonl`
 * (decision 0019).
 */
export const counterShared = {
  id: "counter",
  name: "Days-since counters",
  description:
    "Count the days since something last happened. A reset logs it and starts the count again; completing one closes it.",
  keys: Schema.Struct({}),
  files: ["log.jsonl"],
  fields: CounterFields,
  operations: {
    create_counter: {
      description:
        "Create a days-since counter, which counts the days since something last happened, from now. reset_counter records each time it happens (with at for an earlier time, such as the last time before the counter existed). Moving it to a completed status stops it like any task.",
      readonly: false,
      destructive: false,
      input: Schema.Struct({
        workspace,
        title: title.annotate(cli({ positional: true })),
        ...createFields,
      }),
      success: Task,
      error: inWorkspace(InvalidRequest),
      http: { method: "POST", path: "/workspaces/:workspace/counters" },
      cli: {
        command: ["counter", "create"],
        description: "Create a days-since counter",
        examples: [
          {
            command: 'octo counter create "Days since I last smoked"',
            description: "A counter that starts today",
          },
        ],
      },
    },
    reset_counter: {
      description:
        "Record that the counted thing happened, now or at an earlier time: the count starts again from the latest reset. Resetting at a minute it already has changes nothing.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({
        workspace,
        id,
        at: Schema.optionalKey(DueDate).annotate({
          description:
            "When it happened: YYYY-MM-DD (its midday, or now when that is still to come today) or YYYY-MM-DDTHH:mm; now if omitted",
        }),
      }),
      success: Task,
      error: inWorkspace(InvalidRequest, TaskNotFound),
      http: { method: "POST", path: "/workspaces/:workspace/counters/:id/resets" },
      cli: {
        command: ["counter", "reset"],
        description: "Reset a counter, now or at an earlier time",
        examples: [
          {
            command: "octo counter reset HM-4 --at 2026-10-16",
            description: "It last happened on the 16th",
          },
        ],
      },
    },
    remove_reset: {
      description: "Take back one reset of a counter, by its time as list_resets gives it.",
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
      success: Task,
      error: inWorkspace(InvalidRequest, TaskNotFound),
      http: { method: "DELETE", path: "/workspaces/:workspace/counters/:id/resets/:at" },
      cli: { command: ["counter", "unreset"], description: "Take back one reset" },
    },
    list_resets: {
      description: "List every time a counter was reset, newest first.",
      readonly: true,
      input: Schema.Struct({ workspace, id }),
      success: Schema.Array(Reset),
      error: inWorkspace(InvalidRequest, TaskNotFound),
      http: { method: "GET", path: "/workspaces/:workspace/counters/:id/resets" },
      cli: { command: ["counter", "history"], description: "List when a counter was reset" },
    },
  },
  problems: {
    "bad-line": "That line does not count as a reset",
  },
  label: (fields: CounterFields) => {
    const { current, best } = counted(fields);
    if (fields.since === null || current === null) return "not started";
    return `${daysText(current)} since ${localDay(fields.since)}, best ${daysText(best)}`;
  },
} satisfies PluginShared;
