import { Effect, FileSystem, Path } from "effect";
import { DEFAULT_STATUSES, type Diagnostic, type FixAction } from "./domain.ts";
import { createFolder, freeName, writeFileAtomic } from "./files.ts";
import {
  CONFIG_FILE,
  TASK_FILE,
  TASKS_DIR,
  conflictCopyOf,
  humanize,
  idNumber,
  isLinkField,
  taskFolderName,
} from "./layout.ts";
import { frontmatterId, keepLinks, patchFrontmatter, readFrontmatter } from "./markdown.ts";
import { migrateWorkspace } from "./migrate.ts";
import type { Scan } from "./scan.ts";

/** What a fix knows: the workspace and a scan of it taken just before, which found the problem. */
interface FixContext {
  readonly root: string;
  readonly scan: Scan;
  /** Where the diagnostic points, as an absolute path. */
  readonly target: string;
  readonly diagnostic: Diagnostic;
}

type Handler = (
  context: FixContext,
) => Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path>;

const nextId = ({ scan }: FixContext) => `${scan.snapshot.workspace.key}-${scan.nextIdNumber}`;

/** Gives a task a new id and renames its folder to match, dropping a conflict copy's ` 2`. */
const giveFreshId = (file: string, context: FixContext) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const text = yield* fs.readFileString(file);
    const id = nextId(context);
    yield* writeFileAtomic(file, patchFrontmatter(text, { id }));
    const dir = path.dirname(file);
    const name = conflictCopyOf(path.basename(dir)) ?? path.basename(dir);
    const old = frontmatterId(text);
    const renamed = old !== null && name.startsWith(old) ? `${id}${name.slice(old.length)}` : name;
    const target = path.join(path.dirname(dir), renamed);
    if (target !== dir && !(yield* fs.exists(target))) yield* fs.rename(dir, target);
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
    const id = keep ? own : nextId(context);
    const content = keep ? text : patchFrontmatter(text, { id });
    if (!keep) yield* writeFileAtomic(file, content);
    const title = read.data["title"];
    const name = taskFolderName(id, typeof title === "string" ? title : path.basename(file, ".md"));
    yield* createFolder(container, yield* freeName(container, name), TASK_FILE, content);
    yield* fs.remove(file);
  });

const FIXES: Record<FixAction, Handler> = {
  "fresh-id": (context) => giveFreshId(context.target, context),
  "keep-copy": (context) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { target } = context;
      if ((yield* fs.stat(target)).type === "Directory")
        return yield* giveFreshId(path.join(target, TASK_FILE), context);
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
  "drop-unknown-links": ({ target, diagnostic, scan }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      if (diagnostic.field === null || !isLinkField(diagnostic.field)) return;
      const known = new Set(scan.snapshot.tasks.map((task) => task.id));
      const text = yield* fs.readFileString(target);
      const changed = keepLinks(text, diagnostic.field, (id) => known.has(id));
      if (changed !== null) yield* writeFileAtomic(target, changed);
    }),
  migrate: ({ root }) => Effect.asVoid(migrateWorkspace(root)),
  "add-status": ({ root, diagnostic, scan }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const status = scan.snapshot.tasks.find((task) => task.path === diagnostic.path)?.status;
      if (status === undefined) return;
      const file = path.join(root, TASKS_DIR, CONFIG_FILE);
      const config = JSON.parse(yield* fs.readFileString(file)) as Record<string, unknown>;
      const statuses = Array.isArray(config["statuses"]) ? config["statuses"] : DEFAULT_STATUSES;
      if (statuses.some((known: { id?: unknown }) => known.id === status)) return;
      const added = [...statuses, { id: status, name: humanize(status), category: "unstarted" }];
      yield* writeFileAtomic(file, `${JSON.stringify({ ...config, statuses: added }, null, 2)}\n`);
    }),
};

/** Applies the fix a fresh scan found for `diagnostic`; nothing when it has none. */
export const applyFix = (
  root: string,
  scan: Scan,
  diagnostic: Diagnostic,
): Effect.Effect<void, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (diagnostic.fix === null) return;
    const path = yield* Path.Path;
    const target = path.join(root, diagnostic.path);
    yield* FIXES[diagnostic.fix.action]({ root, scan, target, diagnostic });
  });
