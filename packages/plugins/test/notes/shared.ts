import {
  Entry,
  InvalidRequest,
  StorageError,
  WorkspaceBusy,
  WorkspaceNotFound,
} from "@octodo/contract";
import { cli } from "@octodo/contract/catalog";
import type { PluginShared } from "@octodo/contract/plugin";
import { Schema } from "effect";

/**
 * A plugin made for tests that adds a section: notes in `.octodo/notes/`, each a folder with
 * `note.md`, which may be pinned and counts its views, one line each in `views.log`.
 */
export const notesShared = {
  id: "notes",
  name: "Notes",
  description: "Notes a test keeps.",
  section: { marker: "note.md" },
  keys: Schema.Struct({ pinned: Schema.Boolean }),
  files: ["views.log"],
  fields: Schema.Struct({ pinned: Schema.Boolean, views: Schema.Number }),
  operations: {
    create_note: {
      description: "Create a note.",
      readonly: false,
      input: Schema.Struct({
        workspace: Schema.optionalKey(Schema.String),
        title: Schema.NonEmptyString.annotate(cli({ positional: true })),
        body: Schema.optionalKey(Schema.String),
        pinned: Schema.optionalKey(Schema.Boolean),
      }),
      success: Entry,
      error: Schema.Union([WorkspaceNotFound, StorageError, WorkspaceBusy, InvalidRequest]),
      http: { method: "POST", path: "/workspaces/:workspace/notes" },
      cli: { command: ["note", "create"], description: "Create a note" },
    },
  },
  problems: { "bad-pinned": "Until it is fixed the note is not pinned" },
} satisfies PluginShared;
