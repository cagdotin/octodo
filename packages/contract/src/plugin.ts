import type { Schema } from "effect";
import type { Operation } from "./catalog.ts";
import type { PluginDay } from "./rules.ts";

/**
 * A section a plugin adds: its entries are the folders in `.octodo/<plugin id>/` that hold
 * `marker`. Its entries have no lists and no sub-entries (decision 0027).
 */
export interface PluginSection {
  /** The file that makes a folder one of its entries, a markdown file: `counter.md`. */
  readonly marker: string;
}

/**
 * A plugin's half that any client may import: what its tasks or entries store, what it computes
 * and which operations it offers (decision 0007). Its `engine` half reads and runs them. Without a
 * `section` it is a kind of task; with one, everything it declares is about its section's entries.
 */
export interface PluginShared {
  /**
   * Its name in config.json's `plugins`: `recurring`. The `type` its tasks name, or, with a
   * `section`, that section's folder in `.octodo/`.
   */
  readonly id: string;
  /** What workspace settings call it: `Recurring tasks`. */
  readonly name: string;
  /** A sentence on what enabling it gives, for workspace settings and `list_plugins`. */
  readonly description: string;
  /** The section it adds; none for a kind of task. */
  readonly section?: PluginSection;
  /**
   * The frontmatter keys a task of its kind, or an entry of its section, holds, each with the
   * schema its values decode with.
   */
  readonly keys: Schema.Struct<Schema.Struct.Fields>;
  /** Names at the top of its tasks' or entries' folders that hold its data: never attachments. */
  readonly files: ReadonlyArray<string>;
  /** What it computes when one is read: a task's `kind.fields`, an entry's `fields`. */
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
  /**
   * The day a task of its kind is due on, or an entry of its section falls on, from its fields and
   * today, or none: what `list_tasks`' `due_by` and the app's Today read (decisions 0025, 0027). A
   * plain function from a module the web half imports too, as its web half's `day`.
   */
  readonly day?: PluginDay;
}
