import {
  CreateTaskInput,
  DueDate,
  InvalidRequest,
  StorageError,
  Task,
  TaskNotFound,
  WorkspaceNotFound,
} from "@octodo/contract";
import { cli } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { Schema } from "effect";
import { dueDay, RULE_EXAMPLES } from "./rule.ts";

const workspace = Schema.optionalKey(Schema.String).annotate({
  description: "Registered workspace id or absolute path. Omit to use the current project.",
});

const id = Schema.String.annotate({
  description: "Recurring task id, e.g. HM-42",
  ...cli({ positional: true }),
});

const repeat = Schema.NonEmptyString.annotate({
  description: `How often it comes back: ${RULE_EXAMPLES}`,
  ...cli({ alias: "r" }),
});

const inWorkspace = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union([WorkspaceNotFound, StorageError, InvalidRequest, ...errors]);

/** One time the task was done: UTC, to the minute. */
export const Occurrence = Schema.Struct({ at: Schema.String });

export const RecurringFields = Schema.Struct({
  /** The rule as `repeat` has it, or null when the task has no rule in text. */
  repeat: Schema.NullOr(Schema.String),
  /** The day it is due next, `YYYY-MM-DD`; null when the rule cannot be read. */
  next: Schema.NullOr(Schema.String),
  /** When it was last done, or null if never. */
  last: Schema.NullOr(Schema.String),
  /** How many times it was done. */
  count: Schema.Int,
  /** The latest times it was done, newest first, up to ten; list_occurrences has them all. */
  recent: Schema.Array(Schema.String),
});
export type RecurringFields = typeof RecurringFields.Encoded;

const { title, due: _due, ...createFields } = CreateTaskInput.fields;

/** A task that comes back: `type: recurring`, its rule in `repeat`, its history in `log.jsonl`. */
export const recurringShared = {
  id: "recurring",
  name: "Recurring tasks",
  description:
    "Tasks that come back on a schedule. Completing one logs it and keeps it open until it is due again.",
  keys: Schema.Struct({ repeat: Schema.String }),
  files: ["log.jsonl"],
  fields: RecurringFields,
  operations: {
    create_recurring: {
      description: `Create a recurring task, which comes back after it is done. repeat is its rule, such as ${RULE_EXAMPLES}. It is due on the day it is created, then by its rule after each time it is done. Complete it with move_task to a completed status: that logs the occurrence and keeps it open.`,
      readonly: false,
      destructive: false,
      input: Schema.Struct({
        workspace,
        title: title.annotate(cli({ positional: true })),
        repeat,
        ...createFields,
      }),
      success: Task,
      error: inWorkspace(),
      http: { method: "POST", path: "/workspaces/:workspace/recurring" },
      cli: {
        command: ["recurring", "create"],
        description: "Create a recurring task",
        examples: [
          {
            command: 'octo recurring create "Water the plants" --repeat "every 3 days"',
            description: "A chore that comes back three days after each time",
          },
        ],
      },
    },
    set_repeat: {
      description: "Change a recurring task's rule. The next due day follows the new rule.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({ workspace, id, repeat: repeat.annotate(cli({ positional: true })) }),
      success: Task,
      error: inWorkspace(TaskNotFound),
      http: { method: "PATCH", path: "/workspaces/:workspace/recurring/:id" },
      cli: { command: ["recurring", "repeat"], description: "Change a recurring task's rule" },
    },
    log_occurrence: {
      description:
        "Record that a recurring task was done, now or at an earlier time, without changing its status. Logging a minute it already has changes nothing. To complete it now, move_task to a completed status does the same and reopens it.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({
        workspace,
        id,
        at: Schema.optionalKey(DueDate).annotate({
          description: "When it was done: YYYY-MM-DD (midday) or YYYY-MM-DDTHH:mm; now if omitted",
        }),
      }),
      success: Task,
      error: inWorkspace(TaskNotFound),
      http: { method: "POST", path: "/workspaces/:workspace/recurring/:id/occurrences" },
      cli: {
        command: ["recurring", "log"],
        description: "Record that a recurring task was done",
        examples: [
          {
            command: "octo recurring log HM-4 --at 2026-10-25",
            description: "It was done on the 25th",
          },
        ],
      },
    },
    remove_occurrence: {
      description:
        "Remove one time a recurring task was done, by its time as list_occurrences gives it.",
      readonly: false,
      destructive: true,
      input: Schema.Struct({
        workspace,
        id,
        at: Schema.String.annotate({
          description: "The occurrence's time, e.g. 2026-10-25T09:12:00Z",
          ...cli({ positional: true }),
        }),
      }),
      success: Task,
      error: inWorkspace(TaskNotFound),
      http: { method: "DELETE", path: "/workspaces/:workspace/recurring/:id/occurrences/:at" },
      cli: { command: ["recurring", "unlog"], description: "Remove one logged occurrence" },
    },
    list_occurrences: {
      description: "List every time a recurring task was done, newest first.",
      readonly: true,
      input: Schema.Struct({ workspace, id }),
      success: Schema.Array(Occurrence),
      error: inWorkspace(TaskNotFound),
      http: { method: "GET", path: "/workspaces/:workspace/recurring/:id/occurrences" },
      cli: { command: ["recurring", "history"], description: "List when a task was done" },
    },
  },
  problems: {
    "bad-repeat": "Until it is fixed the task has no next due day; set one with set_repeat",
    "bad-line": "That line does not count as an occurrence",
  },
  label: (fields: RecurringFields) =>
    `${fields.repeat ?? "no rule"}, ${fields.next === null ? "no next day" : `next ${fields.next}`}`,
  day: dueDay,
} satisfies PluginShared;
