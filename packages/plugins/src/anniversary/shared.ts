import {
  CreateTaskInput,
  InvalidRequest,
  StorageError,
  Task,
  TaskNotFound,
  WorkspaceNotFound,
} from "@octodo/contract";
import { cli } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { Schema } from "effect";
import { nextOccurrence, today } from "./day.ts";

const workspace = Schema.optionalKey(Schema.String).annotate({
  description: "Registered workspace id or absolute path. Omit to use the current project.",
});

const date = Schema.String.annotate({
  description:
    "The day it first happened, YYYY-MM-DD, such as a birthday 1990-06-14. It comes back on that day every year; February 29 comes back on the 28th in other years.",
  ...cli({ alias: "d" }),
});

const inWorkspace = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union([WorkspaceNotFound, StorageError, InvalidRequest, ...errors]);

export const AnniversaryFields = Schema.Struct({
  /**
   * The day it first happened, or null when the date cannot be read. The next occurrence depends
   * on today, which a cached read cannot know, so clients compute it with `nextOccurrence`.
   */
  date: Schema.NullOr(Schema.String),
});
export type AnniversaryFields = typeof AnniversaryFields.Encoded;

const { title, due: _due, ...createFields } = CreateTaskInput.fields;

/** A date that comes back every year: `type: anniversary` with the day it happened in `date`. */
export const anniversaryShared = {
  id: "anniversary",
  name: "Anniversaries",
  description:
    "Dates that come back every year, such as birthdays. Each shows its next occurrence and how many years it marks.",
  keys: Schema.Struct({ date: Schema.String }),
  files: [],
  fields: AnniversaryFields,
  operations: {
    create_anniversary: {
      description:
        "Create an anniversary: a task for a date that comes back every year, such as a birthday. date is the day it first happened. Its kind.fields.date is that day; the next occurrence is the first day from today with its month and day, and the years it marks are the years between.",
      readonly: false,
      destructive: false,
      input: Schema.Struct({
        workspace,
        title: title.annotate(cli({ positional: true })),
        date,
        ...createFields,
      }),
      success: Task,
      error: inWorkspace(),
      http: { method: "POST", path: "/workspaces/:workspace/anniversaries" },
      cli: {
        command: ["anniversary", "create"],
        description: "Create an anniversary",
        examples: [
          {
            command: 'octo anniversary create "Mum\'s birthday" --date 1961-06-14',
            description: "A birthday that comes back every June 14",
          },
        ],
      },
    },
    set_anniversary_date: {
      description: "Change the day an anniversary first happened.",
      readonly: false,
      destructive: false,
      idempotent: true,
      input: Schema.Struct({
        workspace,
        id: Schema.String.annotate({
          description: "Anniversary task id, e.g. HM-42",
          ...cli({ positional: true }),
        }),
        date: date.annotate(cli({ positional: true })),
      }),
      success: Task,
      error: inWorkspace(TaskNotFound),
      http: { method: "PATCH", path: "/workspaces/:workspace/anniversaries/:id" },
      cli: { command: ["anniversary", "date"], description: "Change an anniversary's date" },
    },
  },
  problems: {
    "bad-date":
      "Until it is fixed the task has no next occurrence; set one with set_anniversary_date",
  },
  label: (fields: AnniversaryFields, now = new Date()) => {
    if (fields.date === null) return "no date";
    const { next, years } = nextOccurrence(fields.date, today(now));
    return years === 0
      ? `first on ${next}`
      : `next ${next}, ${years} ${years === 1 ? "year" : "years"}`;
  },
} satisfies PluginShared;
