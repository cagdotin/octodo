import type { Schema } from "effect";
import type { Operation } from "./catalog.ts";

/**
 * A plugin's half that any client may import: what its tasks store, what it computes and which
 * operations it offers (decision 0007). Its `engine` half reads and runs them.
 */
export interface PluginShared {
  /** Its name in config.json's `plugins` and the `type` its tasks name: `recurring`. */
  readonly id: string;
  /** The frontmatter keys a task of its kind holds, each with the schema its values decode with. */
  readonly keys: Schema.Struct<Schema.Struct.Fields>;
  /** Names at the top of its tasks' folders that hold its data: they are never attachments. */
  readonly files: ReadonlyArray<string>;
  /** What it computes when a task of its kind is read, as the task's `kind.fields`. */
  readonly fields: Schema.Struct<Schema.Struct.Fields>;
  /** Each runs in one workspace, and only in one that enables the plugin. */
  readonly operations: Readonly<Record<string, Operation>>;
  /** What to do about each problem its reader reports, by name; the kind is `<id>/<name>`. */
  readonly problems: Readonly<Record<string, string>>;
}
