import { Effect } from "effect";
import { basename, dirname, join } from "node:path";
import { DEFAULT_STATUSES, type Diagnostic, type FixAction } from "../domain.ts";
import { frontmatterId, patchFrontmatter, readFrontmatter } from "../frontmatter.ts";
import { TASK_FILE, humanize, idNumber, isLinkField, taskFolderName } from "../layout.ts";
import type { Scan } from "../scan.ts";
import type { Files } from "../storage/files.ts";
import type { AssignedId, Storage } from "../storage/storage.ts";
import { taskFoldersFrom } from "../storage/tree.ts";
import { keepLinks } from "../tasks/task-file.ts";

/** What a fix knows: a scan taken just before, which found the problem, and the write it runs in. */
interface FixContext {
  readonly storage: Storage;
  readonly files: Files;
  readonly scan: Scan;
  /** Where the diagnostic points, as an absolute path. */
  readonly target: string;
  readonly diagnostic: Diagnostic;
  readonly newId: () => AssignedId;
}

type Handler = (context: FixContext) => Effect.Effect<void, unknown>;

/**
 * Gives the copied task in `dir` a new id, and each of its subtasks whose id another folder has,
 * then renames their folders to match. Ids go in before any folder is renamed, deepest folders
 * first, so every path stays valid until it is used.
 */
const renumberCopy = (dir: string, { storage, files, scan, newId }: FixContext) =>
  Effect.gen(function* () {
    const renames: Array<{ dir: string; old: string | null; id: string }> = [];
    for (const folder of taskFoldersFrom(scan.tree, dir)) {
      const file = join(folder, TASK_FILE);
      const text = yield* storage.readText(file);
      const old = frontmatterId(text);
      if (folder !== dir && (old === null || !scan.dirs.tasks.has(old))) continue;
      const id = newId();
      yield* files.writeFile(file, patchFrontmatter(text, { id }));
      renames.push({ dir: folder, old, id });
    }
    for (const { dir: folder, old, id } of renames.toReversed()) {
      const name = basename(folder);
      const renamed =
        old !== null && (name === old || name.startsWith(`${old}-`))
          ? `${id}${name.slice(old.length)}`
          : name;
      yield* files.renameFolder(folder, renamed);
    }
  });

const withId = (text: string, id: AssignedId) => ({ id, content: patchFrontmatter(text, { id }) });

/**
 * Turns a markdown file into a task folder in `container`. The file gets its id in place first,
 * so a run cut short leaves a copy of a known task, which the next scan offers to delete.
 */
const adopt = (file: string, container: string, { storage, files, scan, newId }: FixContext) =>
  Effect.gen(function* () {
    const text = yield* storage.readText(file);
    const read = readFrontmatter(text);
    if ("error" in read) return yield* Effect.fail(new Error(read.error));
    const own = frontmatterId(text);
    const { key } = scan.snapshot.workspace;
    const kept =
      own !== null && idNumber(own, key) !== null && !scan.dirs.tasks.has(own) ? own : null;
    const { id, content } = kept === null ? withId(text, newId()) : { id: kept, content: text };
    if (kept === null) yield* files.writeFile(file, content);
    const title = read.data["title"];
    const name = taskFolderName(id, typeof title === "string" ? title : basename(file, ".md"));
    yield* files.createFolder(container, name, { name: TASK_FILE, content });
    yield* files.remove(file);
  });

/** Rewrites the link field a diagnostic names as a list of the ids in it that `keep` accepts. */
const keepLinksWhere =
  (
    keep: (
      id: string,
      task: { readonly own: string | null; readonly known: ReadonlySet<string> },
    ) => boolean,
  ): Handler =>
  ({ storage, files, target, diagnostic, scan }) =>
    Effect.gen(function* () {
      const { field } = diagnostic;
      if (field === null || !isLinkField(field)) return;
      const text = yield* storage.readText(target);
      const task = {
        own: frontmatterId(text),
        known: scan.idsOnDisk,
      };
      const changed = keepLinks(text, field, (id) => keep(id, task), scan.snapshot.workspace.key);
      if (changed !== null) yield* files.writeFile(target, changed);
    });

const FIXES: Record<FixAction, Handler> = {
  "fresh-id": (context) => renumberCopy(dirname(context.target), context),
  "wrap-as-task": (context) => adopt(context.target, dirname(context.target), context),
  "remove-copy": ({ files, target }) => files.remove(target),
  "drop-unknown-links": keepLinksWhere((id, { known }) => known.has(id)),
  "drop-self-link": keepLinksWhere((id, { own }) => id !== own),
  "normalize-links": keepLinksWhere(() => true),
  "add-status": ({ files, diagnostic, scan }) => {
    const status = scan.snapshot.tasks.find((task) => task.path === diagnostic.path)?.status;
    if (status === undefined) return Effect.void;
    return files.editConfig((config) => {
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
  storage: Storage,
  files: Files,
  scan: Scan,
  diagnostic: Diagnostic,
  newId: () => AssignedId,
): Effect.Effect<void, unknown> => {
  if (diagnostic.fix === null) return Effect.void;
  const target = join(storage.root, diagnostic.path);
  return FIXES[diagnostic.fix.action]({ storage, files, scan, target, diagnostic, newId });
};
