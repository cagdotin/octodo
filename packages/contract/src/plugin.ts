import type { Schema } from "effect";
import type { Operation } from "./catalog.ts";

/**
 * A plugin's half that any client may import: what its tasks store, what it computes and which
 * operations it offers (decision 0007). Its `engine` half reads and runs them.
 */
export interface PluginShared {
  /** Its name in config.json's `plugins` and the `type` its tasks name: `recurring`. */
  readonly id: string;
  /** What workspace settings call it: `Recurring tasks`. */
  readonly name: string;
  /** A sentence on what enabling it gives, for workspace settings and `list_plugins`. */
  readonly description: string;
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
  /**
   * A few words for a task line on the command line, from the task's `kind.fields` as they are
   * encoded: `every 3 days, next 2026-10-31`. It runs when the line is printed, so it may count
   * from now (`12 days since 2026-10-16`); the fields it reads stay absolute, since a read is
   * cached across midnight.
   */
  readonly label?: (fields: never) => string;
}
