import { Effect, FileSystem, Path } from "effect";
import { DEFAULT_STATUSES, type Diagnostic, type FixAction } from "./domain.ts";
import { createFolder, freeName, writeFileAtomic } from "./files.ts";
import {
  TASK_FILE,
  conflictCopyOf,
  humanize,
  idNumber,
  isLinkField,
  taskFolderName,
} from "./layout.ts";
import { frontmatterId, keepLinks, patchFrontmatter, readFrontmatter } from "./markdown.ts";
import type { Scan } from "./scan.ts";
import { editConfig } from "./storage/config.ts";
import { taskFoldersFrom } from "./storage/tree.ts";

/** What a fix knows: the workspace and a scan of it taken just before, which found the problem. */
interface FixContext {
  readonly root: string;
  readonly scan: Scan;
  /** Where the diagnostic points, as an absolute path. */
  readonly target: string;
  readonly diagnostic: Diagnostic;
  /** A task id no task has and no other call hands out; the fix runs holding the owner lock. */
  readonly newId: Effect.Effect<string>;
}

type Handler = (
  context: FixContext,
) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path>;

/**
 * Gives the copied task in `dir` a new id, and each of its subtasks whose id another folder has,
 * then renames their folders to match, dropping a conflict copy's ` 2`. Ids go in before any
 * folder is renamed, deepest folders first, so every path stays valid until it is used.
 */
const renumberCopy = (dir: string, context: FixContext) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const renames: Array<{ dir: string; old: string | null; id: string }> = [];
    for (const folder of taskFoldersFrom(context.scan.tree, dir)) {
      const file = path.join(folder, TASK_FILE);
      const text = yield* fs.readFileString(file);
      const old = frontmatterId(text);
      if (folder !== dir && (old === null || !context.scan.dirs.tasks.has(old))) continue;
      const id = yield* context.newId;
      yield* writeFileAtomic(file, patchFrontmatter(text, { id }));
      renames.push({ dir: folder, old, id });
    }
    for (const { dir: folder, old, id } of renames.toReversed()) {
      const name = conflictCopyOf(path.basename(folder)) ?? path.basename(folder);
      const renamed =
        old !== null && (name === old || name.startsWith(`${old}-`))
          ? `${id}${name.slice(old.length)}`
          : name;
      const target = path.join(path.dirname(folder), renamed);
      if (target !== folder && !(yield* fs.exists(target))) yield* fs.rename(folder, target);
    }
  });

/**
 * Turns a markdown file into a task folder in `container`. The file gets its id in place first,
 * so a run cut short leaves a copy of a known task, which the next scan offers to delete.
 */
const adopt = (file: string, container: string, context: FixContext) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(file);
    const read = readFrontmatter(text);
    if ("error" in read) return yield* Effect.fail(new Error(read.error));
    const own = frontmatterId(text);
    const { key } = context.scan.snapshot.workspace;
    const keep = own !== null && idNumber(own, key) !== null && !context.scan.dirs.tasks.has(own);
    const id = keep ? own : yield* context.newId;
    const content = keep ? text : patchFrontmatter(text, { id });
    if (!keep) yield* writeFileAtomic(file, content);
    const title = read.data["title"];
    const name = taskFolderName(id, typeof title === "string" ? title : path.basename(file, ".md"));
    yield* createFolder(container, yield* freeName(container, name), TASK_FILE, content);
    yield* fs.remove(file);
  });

/** Rewrites the link field a diagnostic names as a list of the ids in it that `keep` accepts. */
const keepLinksWhere =
  (
    keep: (
      id: string,
      task: { readonly own: string | null; readonly known: ReadonlySet<string> },
    ) => boolean,
  ): Handler =>
  ({ target, diagnostic, scan }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { field } = diagnostic;
      if (field === null || !isLinkField(field)) return;
      const text = yield* fs.readFileString(target);
      const task = {
        own: frontmatterId(text),
        known: scan.idsOnDisk,
      };
      const changed = keepLinks(text, field, (id) => keep(id, task), scan.snapshot.workspace.key);
      if (changed !== null) yield* writeFileAtomic(target, changed);
    });

const FIXES: Record<FixAction, Handler> = {
  "fresh-id": (context) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      yield* renumberCopy(path.dirname(context.target), context);
    }),
  "keep-copy": (context) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { target } = context;
      if ((yield* fs.stat(target)).type === "Directory")
        return yield* renumberCopy(target, context);
      yield* adopt(target, path.dirname(path.dirname(target)), context);
    }),
  "wrap-as-task": (context) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      yield* adopt(context.target, path.dirname(context.target), context);
    }),
  "remove-copy": ({ target }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.remove(target, { recursive: true });
    }),
  "drop-unknown-links": keepLinksWhere((id, { known }) => known.has(id)),
  "drop-self-link": keepLinksWhere((id, { own }) => id !== own),
  "normalize-links": keepLinksWhere(() => true),
  "add-status": ({ root, diagnostic, scan }) => {
    const status = scan.snapshot.tasks.find((task) => task.path === diagnostic.path)?.status;
    if (status === undefined) return Effect.void;
    return editConfig(root, (config) => {
      const statuses = config.statuses ?? DEFAULT_STATUSES;
      if (statuses.some((known) => known.id === status)) return null;
      return {
        statuses: [...statuses, { id: status, name: humanize(status), category: "unstarted" }],
      };
    });
  },
};

/** Applies the fix a fresh scan found for `diagnostic`; nothing when it has none. */
export const applyFix = (
  root: string,
  scan: Scan,
  diagnostic: Diagnostic,
  newId: FixContext["newId"],
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (diagnostic.fix === null) return;
    const path = yield* Path.Path;
    const target = path.join(root, diagnostic.path);
    yield* FIXES[diagnostic.fix.action]({ root, scan, target, diagnostic, newId });
  });
