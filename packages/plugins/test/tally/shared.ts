import {
  InvalidRequest,
  StorageError,
  Task,
  TaskNotFound,
  WorkspaceNotFound,
} from "@octodo/contract";
import { cli } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { Schema } from "effect";

const workspace = Schema.optionalKey(Schema.String);

/** A plugin made for tests: a task that counts bumps, `step` at a time, logged in `tally.log`. */
export const tallyShared = {
  id: "tally",
  keys: Schema.Struct({ step: Schema.Int.check(Schema.isGreaterThan(0)) }),
  files: ["tally.log"],
  fields: Schema.Struct({ count: Schema.Number, last: Schema.NullOr(Schema.String) }),
  operations: {
    create_tally: {
      description: "Create a tally.",
      readonly: false,
      input: Schema.Struct({
        workspace,
        title: Schema.NonEmptyString.annotate(cli({ positional: true })),
        step: Schema.Int,
      }),
      success: Task,
      error: Schema.Union([WorkspaceNotFound, StorageError, InvalidRequest]),
      http: { method: "POST", path: "/workspaces/:workspace/tallies" },
      cli: { command: ["tally", "create"], description: "Create a tally" },
    },
    bump_tally: {
      description: "Bump a tally once.",
      readonly: false,
      input: Schema.Struct({
        workspace,
        id: Schema.String.annotate(cli({ positional: true })),
      }),
      success: Task,
      error: Schema.Union([WorkspaceNotFound, StorageError, TaskNotFound, InvalidRequest]),
      http: { method: "POST", path: "/workspaces/:workspace/tallies/:id/bump" },
      cli: { command: ["tally", "bump"], description: "Bump a tally" },
    },
  },
  problems: {
    "bad-step": "Until it is fixed each bump counts one",
    "bad-line": "That line is not counted",
  },
} satisfies PluginShared;
