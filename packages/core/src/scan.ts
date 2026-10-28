import { Effect, FileSystem, Option, Path, PlatformError, Result, Semaphore } from "effect";
import { diagnostic, type DiagnosticOptions } from "./diagnostics.ts";
import {
  DEFAULT_STATUSES,
  type Diagnostic,
  type DiagnosticKind,
  type List,
  type StatusDefinition,
  type Task,
  type WorkspaceSnapshot,
} from "./domain.ts";
import { isNotFound, sameTree } from "./files.ts";
import {
  CONFIG_FILE,
  LIST_FILE,
  MAX_LIST_DEPTH,
  TASK_FILE,
  TASKS_DIR,
  conflictCopyOf,
  defaultStatus,
  humanize,
  idNumber,
  listDepth,
  sortStatuses,
  taskFolderName,
} from "./layout.ts";
import { linkTasks } from "./links.ts";
import {
  frontmatterId,
  hasFrontmatter,
  readFrontmatter,
  readListFile,
  readTaskFile,
  type TaskFile,
  type TaskFileRead,
  type TaskPlace,
} from "./markdown.ts";
import type { ScanCache } from "./scan-cache.ts";
import { readConfig } from "./storage/config.ts";

/** A snapshot plus where its lists and tasks are on disk, which is nobody else's business. */
export interface Scan {
  readonly snapshot: WorkspaceSnapshot;
  readonly dirs: {
    /** Each list's absolute folder and the order key from its `list.md`. */
    readonly lists: ReadonlyMap<string, { readonly dir: string; readonly order: string }>;
    /** Each task's absolute folder. */
    readonly tasks: ReadonlyMap<string, string>;
  };
  /** Every id a markdown file on disk has, in tasks read or not: links to them are not broken. */
  readonly idsOnDisk: ReadonlySet<string>;
  /** The number of the next new task id: past every id on disk, in tasks read or not. */
  readonly nextIdNumber: number;
  /** Task folders whose `task.md` has no id yet, each reported as `missing-id`. */
  readonly missingId: ReadonlyArray<string>;
}

/** Orders by fractional key, keys before no key, then by folder name. */
const compareOrder = (
  a: { readonly order: string; readonly name: string },
  b: { readonly order: string; readonly name: string },
): number => {
  if (a.order !== b.order) {
    if (a.order === "") return 1;
    if (b.order === "") return -1;
    return a.order < b.order ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

const compareTasks =
  (key: string) =>
  (a: Pick<Task, "id" | "order">, b: Pick<Task, "id" | "order">): number => {
    if (a.order !== b.order) {
      if (a.order === "") return 1;
      if (b.order === "") return -1;
      return a.order < b.order ? -1 : 1;
    }
    const byNumber = (idNumber(a.id, key) ?? Infinity) - (idNumber(b.id, key) ?? Infinity);
    return byNumber !== 0 && !Number.isNaN(byNumber)
      ? byNumber
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
  };

/** What a scan reads of a folder before it judges any of it. */
interface Listing {
  /** The folder's entries in name order, dot entries and entries gone since aside. */
  readonly entries: Result.Result<ReadonlyArray<Entry>, PlatformError.PlatformError>;
}

type Entry = { readonly name: string; readonly path: string } & (
  | { readonly type: "file"; readonly mtime: Date | null }
  | { readonly type: "both" }
  | { readonly type: "folder" }
  | {
      readonly type: "task";
      readonly file: Result.Result<
        { readonly text: string; readonly mtime: Date | null },
        PlatformError.PlatformError
      >;
      readonly listing: Listing;
    }
  | {
      readonly type: "list";
      readonly file: Result.Result<string, PlatformError.PlatformError>;
      readonly listing: Listing;
    }
  | { readonly type: "symlink"; readonly target: string }
  | { readonly type: "unreadable"; readonly error: PlatformError.PlatformError }
);

const FOLDER_ENTRIES_AT_ONCE = 32;
/**
 * How many files a scan reads at once. Only a file read holds a descriptor across several system
 * calls; listing a folder or a stat holds one within a single call.
 */
const OPEN_FILES = 32;

/** What a scan reads at one path before it reads the folders inside it. */
type Node =
  | { readonly type: "symlink"; readonly target: string }
  | { readonly type: "file"; readonly mtime: Date | null }
  | {
      readonly type: "folder";
      readonly names: Result.Result<ReadonlyArray<string>, PlatformError.PlatformError>;
      /** The text of its `task.md` or `list.md`, or null when it has none. */
      readonly task: Result.Result<string, PlatformError.PlatformError> | null;
      readonly list: Result.Result<string, PlatformError.PlatformError> | null;
    };

/** Whether `node` holds what is on disk until its path changes: it is there and every read worked. */
const settled = (node: Node | null): boolean =>
  node !== null &&
  (node.type !== "folder" ||
    (Result.isSuccess(node.names) &&
      [node.task, node.list].every((read) => read === null || Result.isSuccess(read))));

/**
 * Reads the folder tree under `dir` that a scan walks, many folders at once: each folder's entries,
 * and the `task.md` or `list.md` of each task and list folder. What `cache` holds of a path is not
 * read again.
 */
const readListing = (
  dir: string,
  cache: ScanCache | undefined,
): Effect.Effect<Listing, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const openFiles = yield* Semaphore.make(OPEN_FILES);
    const readFile = (file: string) => openFiles.withPermits(1)(fs.readFileString(file));

    /**
     * The marker file `file` read, or null when the folder does not have it. A failed read asks
     * `exists`, so a dangling link or an unlistable folder decides as it would.
     */
    const readMarker = (
      names: Result.Result<ReadonlyArray<string>, PlatformError.PlatformError>,
      file: string,
    ) =>
      Effect.gen(function* () {
        if (Result.isSuccess(names) && !names.success.includes(path.basename(file))) return null;
        const result = yield* Effect.result(readFile(file));
        if (Result.isSuccess(result)) return result;
        return (yield* fs.exists(file)) ? result : null;
      });

    const readNode = (at: string) =>
      Effect.gen(function* () {
        const info = yield* fs.lstat(at);
        if (info.type === "SymbolicLink")
          return { type: "symlink" as const, target: yield* fs.readLink(at) };
        if (info.type === "File")
          return { type: "file" as const, mtime: Option.getOrNull(info.mtime) };
        if (info.type !== "Directory") return null;
        const names = yield* Effect.result(fs.readDirectory(at));
        const task = yield* readMarker(names, path.join(at, TASK_FILE));
        const list = yield* readMarker(names, path.join(at, LIST_FILE));
        if (task === null && list === null) {
          // A folder that can be listed but not entered fails here, and is reported unreadable.
          yield* fs.exists(path.join(at, TASK_FILE));
          yield* fs.exists(path.join(at, LIST_FILE));
        }
        return { type: "folder" as const, names, task, list };
      });

    /**
     * Whether the folder `dir` has a `task.md` or `list.md` that is a link: what a folder like that
     * is follows its targets, whose changes report no path in the workspace, so it is read anew
     * each scan.
     */
    const linksMarker = (
      cache: ScanCache,
      dir: string,
      names: Result.Result<ReadonlyArray<string>, PlatformError.PlatformError>,
    ) =>
      Effect.forEach(
        [TASK_FILE, LIST_FILE].filter(
          (marker) => Result.isSuccess(names) && names.success.includes(marker),
        ),
        (marker) => {
          const file = path.join(dir, marker);
          return Effect.map(
            cache.read(file, "node", readNode(file), settled),
            (node) => node?.type === "symlink",
          );
        },
      ).pipe(Effect.map((links) => links.includes(true)));

    /** A `task.md` that is a link, read anew each scan: a change to its target reports neither path. */
    const readLinkedTask = (file: string) =>
      Effect.all({
        text: readFile(file),
        mtime: Effect.map(fs.stat(file), (info) => Option.getOrNull(info.mtime)),
      });

    const entry = (
      dir: string,
      name: string,
    ): Effect.Effect<Entry | null, never, FileSystem.FileSystem | Path.Path> => {
      const child = path.join(dir, name);
      return Effect.gen(function* () {
        const kept: Node | null =
          cache === undefined
            ? yield* readNode(child)
            : yield* cache.read(child, "node", readNode(child), settled);
        if (kept === null) return null;
        if (kept.type !== "folder") return { name, path: child, ...kept };
        const node =
          cache !== undefined && (yield* linksMarker(cache, child, kept.names))
            ? yield* readNode(child)
            : kept;
        if (node?.type !== "folder") return null;
        const { names, task, list } = node;
        if (task !== null && list !== null) return { name, path: child, type: "both" as const };
        if (task !== null) {
          const taskListing = yield* listing(child, names);
          const listed = Result.isSuccess(taskListing.entries)
            ? taskListing.entries.success.find((entry) => entry.name === TASK_FILE)
            : undefined;
          const file =
            listed?.type === "file"
              ? Result.map(task, (text) => ({ text, mtime: listed.mtime }))
              : Result.isFailure(task)
                ? Result.fail(task.failure)
                : yield* Effect.result(readLinkedTask(path.join(child, TASK_FILE)));
          return { name, path: child, type: "task" as const, file, listing: taskListing };
        }
        if (list !== null)
          return {
            name,
            path: child,
            type: "list" as const,
            file: list,
            listing: yield* listing(child, names),
          };
        return { name, path: child, type: "folder" as const };
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed<Entry | null>(
            isNotFound(error) ? null : { name, path: child, type: "unreadable", error },
          ),
        ),
      );
    };

    const listing = (
      dir: string,
      names: Result.Result<ReadonlyArray<string>, PlatformError.PlatformError>,
    ): Effect.Effect<Listing, never, FileSystem.FileSystem | Path.Path> =>
      Result.isFailure(names)
        ? Effect.succeed({ entries: Result.fail(names.failure) })
        : Effect.forEach(
            names.success.filter((name) => !name.startsWith(".")).toSorted(),
            (name) => entry(dir, name),
            { concurrency: FOLDER_ENTRIES_AT_ONCE },
          ).pipe(
            Effect.map((found) => ({
              entries: Result.succeed(found.filter((entry) => entry !== null)),
            })),
          );

    const names = fs.readDirectory(dir);
    return yield* listing(
      dir,
      yield* Effect.result(cache === undefined ? names : cache.read(dir, "names", names)),
    );
  });

/**
 * Reads `.octodo/` by its grammar: folders with `task.md` are tasks, folders with `list.md` lists.
 * With a `cache`, it reads only the folders and files that changed since the scans that filled it.
 */
export const scanWorkspace = (
  id: string,
  root: string,
  cache?: ScanCache,
): Effect.Effect<Scan, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tasksDir = path.join(root, TASKS_DIR);
    const rel = (absolute: string) => path.relative(root, absolute);
    const diagnostics: Array<Diagnostic> = [];
    const report = <K extends DiagnosticKind>(
      kind: K,
      absolute: string,
      detail: string,
      options?: DiagnosticOptions<K>,
    ) => diagnostics.push(diagnostic(kind, rel(absolute), detail, options));
    const unreadable = (absolute: string, error: unknown, failure = "Could not read it") => {
      if (!isNotFound(error)) report("unreadable", absolute, `${failure}: ${String(error)}`);
    };
    /** What a read ahead of the scan got, or null after reporting why it got nothing. */
    const readAhead = <A>(
      absolute: string,
      result: Result.Result<A, PlatformError.PlatformError>,
      failure?: string,
    ): A | null => {
      if (Result.isSuccess(result)) return result.success;
      unreadable(absolute, result.failure, failure);
      return null;
    };

    const { config, fallback, problems: configProblems } = yield* readConfig(root);
    for (const { kind, detail, field } of configProblems)
      report(kind, path.join(tasksDir, CONFIG_FILE), detail, { field });
    const statuses: Array<StatusDefinition> = [...(config.statuses ?? DEFAULT_STATUSES)];
    const fallbackStatus = defaultStatus(statuses)?.id ?? "todo";

    const lists: Array<List> = [];
    const taskFiles: Array<TaskFile> = [];
    const listDirs = new Map<string, { dir: string; order: string }>();
    const taskDirs = new Map<string, string>();
    const missingId: Array<string> = [];
    /** Markdown files that are not tasks: loose in a list, or a sync tool's copy of a marker file. */
    const strays: Array<{
      file: string;
      kind: "loose-markdown" | "conflict-copy";
      /** The marker file it is a conflict copy of. */
      copyOf: string | null;
    }> = [];
    let highestId = 0;
    const idsOnDisk = new Set<string>();
    const takeId = (taskId: string | null) => {
      if (taskId === null) return;
      idsOnDisk.add(taskId);
      highestId = Math.max(highestId, idNumber(taskId, config.key) ?? 0);
    };
    /** Takes the ids of every markdown file under `target`, which the scan does not read. */
    const takeIdsUnder = (target: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const info = yield* fs.lstat(target);
        if (info.type === "File") {
          if (target.endsWith(".md")) takeId(frontmatterId(yield* fs.readFileString(target)));
          return;
        }
        if (info.type !== "Directory") return;
        for (const name of yield* fs.readDirectory(target)) {
          if (!name.startsWith(".")) yield* takeIdsUnder(path.join(target, name));
        }
      }).pipe(Effect.ignore);

    /** The entries of the folder `dir` the scan judges, after reporting the ones it cannot. */
    const entries = (
      dir: string,
      listing: Listing,
    ): Array<Exclude<Entry, { type: "symlink" | "unreadable" }>> => {
      const judged = [];
      for (const entry of readAhead(dir, listing.entries) ?? []) {
        if (entry.type === "symlink")
          report("symlink", entry.path, `This is a link to ${entry.target}`);
        else if (entry.type === "unreadable") unreadable(entry.path, entry.error);
        else judged.push(entry);
      }
      return judged;
    };

    const readText = (file: string) =>
      fs.readFileString(file).pipe(Effect.orElseSucceed(() => null));

    /**
     * A second folder with an id already read: a sync tool's conflict copy when its name says so
     * (removable when it matches the first folder byte for byte), else a copied task.
     */
    const reportDuplicate = (dir: string, taskId: string) =>
      Effect.gen(function* () {
        const file = path.join(dir, TASK_FILE);
        const original = taskDirs.get(taskId)!;
        if (conflictCopyOf(path.basename(dir)) === null) {
          report("duplicate-id", file, `The task ${rel(original)} already has the id ${taskId}`, {
            field: "id",
          });
          return;
        }
        const identical = yield* sameTree(dir, original).pipe(Effect.orElseSucceed(() => false));
        report(
          "conflict-copy",
          dir,
          `This folder is a copy of ${rel(original)}${identical ? " with the same files" : ", with changes"}`,
          { fix: identical ? "remove-copy" : "keep-copy" },
        );
      });

    /**
     * A markdown file that is not a task. One that matches the task its id names (or the file it
     * copies) byte for byte is redundant; the rest can become tasks when their frontmatter parses,
     * except a copy of list.md.
     */
    const reportStray = ({ file, kind, copyOf }: (typeof strays)[number]) =>
      Effect.gen(function* () {
        const text = yield* readText(file);
        if (text === null) return;
        const named = frontmatterId(text);
        const twinDir = named === null ? undefined : taskDirs.get(named);
        const twin = twinDir === undefined ? copyOf : path.join(twinDir, TASK_FILE);
        const identical = twin !== null && (yield* readText(twin)) === text;
        const parses = !("error" in readFrontmatter(text));
        const adoptable = parses && copyOf?.endsWith(LIST_FILE) !== true;
        const same = !identical
          ? ""
          : twin === copyOf
            ? " and identical to it"
            : `, the same as ${rel(twin)}`;
        const broken = parses ? "" : ", and its frontmatter does not parse";
        if (kind === "loose-markdown" && !hasFrontmatter(text))
          report("note", file, "This markdown file has no frontmatter, so it is read as a note");
        else if (kind === "loose-markdown")
          report(kind, file, `This markdown file is not in a task folder${same}${broken}`, {
            fix: identical ? "remove-copy" : adoptable ? "wrap-as-task" : null,
          });
        else
          report(kind, file, `This is a conflict copy of ${rel(copyOf!)}${same}${broken}`, {
            fix: identical ? "remove-copy" : adoptable ? "keep-copy" : null,
          });
      });

    interface Waiting {
      readonly dir: string;
      readonly listing: Listing;
      readonly list: string | null;
      readonly read: Exclude<TaskFileRead, { _tag: "Invalid" }>;
    }
    /**
     * Task folders read and waiting to be served, by rank, each in reading order. Of several
     * folders with one id, the lowest rank is the task: 0 for a folder named after its id and
     * title, 1 for another name, 2 for a sync tool's copy. The first read breaks a tie.
     */
    const waiting: readonly [Array<Waiting>, Array<Waiting>, Array<Waiting>] = [[], [], []];

    /**
     * `readTaskFile`, kept with what the cache holds of the task folder `dir`. A `task.md` that is a
     * link is read anew each scan, so a kept read is used only for the same text.
     */
    const parseTask = (dir: string, text: string, place: TaskPlace) => {
      const parse = Effect.sync(() => ({ text, read: readTaskFile(text, place) }));
      return Effect.map(
        cache === undefined ? parse : cache.read(dir, JSON.stringify(place), parse),
        (kept) => (kept.text === text ? kept.read : readTaskFile(text, place)),
      );
    };

    const readTask = (
      task: Extract<Entry, { type: "task" }>,
      list: string | null,
      parent: string | null,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const dir = task.path;
        const file = path.join(dir, TASK_FILE);
        const contents = readAhead(
          file,
          task.file,
          `Could not read it; this task and its subtasks are not read`,
        );
        if (contents === null) return;
        const { text, mtime } = contents;
        const folder = path.basename(dir);
        const read = yield* parseTask(dir, text, {
          list,
          parent,
          path: rel(file),
          folder,
          defaultStatus: fallbackStatus,
          updated: mtime === null ? null : mtime.toISOString(),
          key: config.key,
        });
        if (read._tag === "Invalid") {
          const { kind, field, detail } = read.problem;
          report(kind, file, `${detail}; this task and its subtasks are not read`, { field });
          yield* takeIdsUnder(dir);
          return;
        }
        const rank =
          conflictCopyOf(folder) !== null
            ? 2
            : read._tag === "Read" && folder !== taskFolderName(read.value.id, read.value.title)
              ? 1
              : 0;
        waiting[rank].push({ dir, listing: task.listing, list, read });
      });

    const serveTask = ({
      dir,
      listing,
      list,
      read,
    }: Waiting): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const file = path.join(dir, TASK_FILE);
        let id: string | null = null;
        if (read._tag === "MissingId") {
          missingId.push(dir);
          report("missing-id", file, "This task has no id yet", { field: "id" });
        } else if (taskDirs.has(read.value.id)) {
          yield* reportDuplicate(dir, read.value.id);
          yield* takeIdsUnder(dir);
          return;
        } else {
          id = read.value.id;
          takeId(id);
          taskDirs.set(id, dir);
          taskFiles.push(read.value);
          for (const problem of read.problems) report(problem.kind, file, problem.detail, problem);
          if (idNumber(id, config.key) === null)
            report(
              "foreign-id",
              file,
              `The id ${id} does not use the workspace key ${config.key}`,
              {
                field: "id",
              },
            );
        }
        for (const entry of entries(dir, listing)) {
          if (entry.type === "task") yield* readTask(entry, list, id);
          else if (entry.type === "list") {
            report("list-in-task", entry.path, "This folder has list.md inside a task");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "both") {
            report("both-markers", entry.path, "This folder has both task.md and list.md");
            yield* takeIdsUnder(entry.path);
          } else if (
            entry.type === "file" &&
            conflictCopyOf(entry.name) === TASK_FILE &&
            id !== null &&
            frontmatterId((yield* readText(entry.path)) ?? "") === id
          ) {
            strays.push({ file: entry.path, kind: "conflict-copy", copyOf: file });
          }
        }
      });

    const readList = (
      dir: string,
      listing: Listing,
      list: string | null,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const children: Array<{
          name: string;
          path: string;
          listing: Listing;
          order: string;
          list: List;
        }> = [];
        for (const entry of entries(dir, listing)) {
          if (entry.type === "file") {
            if (entry.name.endsWith(".md") && (list === null || entry.name !== LIST_FILE)) {
              const copyOf = list !== null && conflictCopyOf(entry.name) === LIST_FILE;
              strays.push(
                copyOf
                  ? { file: entry.path, kind: "conflict-copy", copyOf: path.join(dir, LIST_FILE) }
                  : { file: entry.path, kind: "loose-markdown", copyOf: null },
              );
              yield* takeIdsUnder(entry.path);
            }
          } else if (entry.type === "task") {
            yield* readTask(entry, list, null);
          } else if (entry.type === "both") {
            report("both-markers", entry.path, "This folder has both task.md and list.md");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "folder") {
            report("unmarked-folder", entry.path, "This folder has neither task.md nor list.md");
            yield* takeIdsUnder(entry.path);
          } else if (listDepth(list) >= MAX_LIST_DEPTH) {
            report("list-too-deep", entry.path, `This list is ${listDepth(list) + 1} levels deep`);
            yield* takeIdsUnder(entry.path);
          } else {
            const file = path.join(entry.path, LIST_FILE);
            const text = readAhead(file, entry.file);
            const read = text === null ? null : readListFile(text);
            if (read?._tag === "Invalid")
              report(
                read.problem.kind,
                file,
                `${read.problem.detail}; the list reads with its folder name`,
              );
            const listFile = read?._tag === "Read" ? read.value : null;
            const listId = list === null ? entry.name : `${list}/${entry.name}`;
            children.push({
              name: entry.name,
              path: entry.path,
              listing: entry.listing,
              order: listFile?.order ?? "",
              list: {
                id: listId,
                name: listFile?.name ?? humanize(entry.name),
                parent: list,
                folder: path.relative(tasksDir, entry.path),
              },
            });
          }
        }
        for (const child of children.toSorted(compareOrder)) {
          lists.push(child.list);
          listDirs.set(child.list.id, { dir: child.path, order: child.order });
          yield* readList(child.path, child.listing, child.list.id);
        }
      });

    yield* readList(tasksDir, yield* readListing(tasksDir, cache), null);
    const nextWaiting = () => waiting.find((queue) => queue.length > 0)?.shift();
    for (let next = nextWaiting(); next !== undefined; next = nextWaiting()) yield* serveTask(next);

    for (const stray of strays) yield* reportStray(stray);
    for (const task of taskFiles) {
      if (statuses.some((known) => known.id === task.status)) continue;
      statuses.push({ id: task.status, name: humanize(task.status), category: "unstarted" });
      report(
        "unknown-status",
        path.join(root, task.path),
        `The status "${task.status}" is not in config.json`,
        { field: "status", fix: fallback ? null : "add-status" },
      );
    }

    const compare = compareTasks(config.key);
    const { tasks, diagnostics: linkDiagnostics } = linkTasks(
      taskFiles.toSorted(compare),
      statuses,
      idsOnDisk,
    );
    diagnostics.push(...linkDiagnostics);
    return {
      snapshot: {
        workspace: { id, name: config.name, key: config.key, root },
        statuses: sortStatuses(statuses),
        lists,
        tasks,
        diagnostics,
      },
      dirs: { lists: listDirs, tasks: taskDirs },
      idsOnDisk,
      nextIdNumber: highestId + 1,
      missingId,
    };
  });
