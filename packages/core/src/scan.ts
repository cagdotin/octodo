import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { diagnostic, type DiagnosticOptions } from "./diagnostics.ts";
import {
  DEFAULT_STATUSES,
  WorkspaceConfig,
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
  deriveKey,
  humanize,
  idNumber,
  listDepth,
  sortStatuses,
} from "./layout.ts";
import { linkTasks } from "./links.ts";
import { oldLayoutFolder } from "./migrate.ts";
import {
  frontmatterId,
  readFrontmatter,
  readListFile,
  readTaskFile,
  type TaskFile,
} from "./markdown.ts";
import { claimIds, giveId, pendingId } from "./ids.ts";

/** A snapshot plus where its lists and tasks are on disk, which is nobody else's business. */
export interface Scan {
  readonly snapshot: WorkspaceSnapshot;
  readonly dirs: {
    /** Each list's absolute folder and the order key from its `list.md`. */
    readonly lists: ReadonlyMap<string, { readonly dir: string; readonly order: string }>;
    /** Each task's absolute folder. */
    readonly tasks: ReadonlyMap<string, string>;
  };
  /** The number of the next new task id: past every id on disk, in tasks read or not. */
  readonly nextIdNumber: number;
  /** Whether folders of the old layout are left, which `octo migrate` converts. */
  readonly oldLayout: boolean;
}

const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(WorkspaceConfig));

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

/** Reads `.octodo/` by its grammar: folders with `task.md` are tasks, folders with `list.md` lists. */
export const scanWorkspace = (
  id: string,
  root: string,
  options: { readonly assignIds: boolean } = { assignIds: true },
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
    /**
     * What `effect` reads from one entry, or null when it fails: silently when the entry is gone
     * (another process moved it), as a diagnostic otherwise.
     */
    const attempt = <A, E, R>(
      absolute: string,
      effect: Effect.Effect<A, E, R>,
      failure = "Could not read it",
    ): Effect.Effect<A | null, never, R> =>
      Effect.catch(effect, (error) => {
        if (!isNotFound(error)) report("unreadable", absolute, `${failure}: ${String(error)}`);
        return Effect.succeed(null);
      });

    const config = yield* fs.readFileString(path.join(tasksDir, CONFIG_FILE)).pipe(
      Effect.flatMap(decodeConfig),
      Effect.catch((error) => {
        report("invalid-config", path.join(tasksDir, CONFIG_FILE), String(error));
        const name = humanize(path.basename(root));
        return Effect.succeed<WorkspaceConfig>({ name, key: deriveKey(name) });
      }),
    );
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
    const legacyFolders: Array<string> = [];
    let highestId = 0;
    const takeId = (taskId: string | null) => {
      if (taskId !== null) highestId = Math.max(highestId, idNumber(taskId, config.key) ?? 0);
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

    const entries = (dir: string) =>
      Effect.gen(function* () {
        const found: Array<{
          name: string;
          path: string;
          type: "file" | "task" | "list" | "both" | "folder";
        }> = [];
        for (const name of ((yield* attempt(dir, fs.readDirectory(dir))) ?? []).toSorted()) {
          if (name.startsWith(".")) continue;
          const child = path.join(dir, name);
          const type = yield* attempt(
            child,
            Effect.gen(function* () {
              const info = yield* fs.stat(child);
              if (info.type === "File") return "file";
              if (info.type !== "Directory") return null;
              const task = yield* fs.exists(path.join(child, TASK_FILE));
              const list = yield* fs.exists(path.join(child, LIST_FILE));
              return task && list ? "both" : task ? "task" : list ? "list" : "folder";
            }),
          );
          if (type !== null) found.push({ name, path: child, type });
        }
        return found;
      });

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
        if (kind === "loose-markdown")
          report(kind, file, `This markdown file is not in a task folder${same}${broken}`, {
            fix: identical ? "remove-copy" : adoptable ? "wrap-as-task" : null,
          });
        else
          report(kind, file, `This is a conflict copy of ${rel(copyOf!)}${same}${broken}`, {
            fix: identical ? "remove-copy" : adoptable ? "keep-copy" : null,
          });
      });

    const readTask = (
      dir: string,
      list: string | null,
      parent: string | null,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const file = path.join(dir, TASK_FILE);
        const contents = yield* attempt(
          file,
          Effect.all([fs.readFileString(file), fs.stat(file)]),
          `Could not read it; this task and its subtasks are not read`,
        );
        if (contents === null) return;
        const [text, info] = contents;
        const mtime = Option.getOrNull(info.mtime);
        const read = readTaskFile(text, {
          list,
          parent,
          path: rel(file),
          folder: path.basename(dir),
          defaultStatus: fallbackStatus,
          updated: mtime === null ? null : mtime.toISOString(),
        });
        if (read._tag === "Invalid") {
          const { kind, field, detail } = read.problem;
          report(kind, file, `${detail}; this task and its subtasks are not read`, { field });
          yield* takeIdsUnder(dir);
          return;
        }
        let id: string | null = null;
        if (read._tag === "MissingId") {
          missingId.push(dir);
          takeId(yield* pendingId(dir));
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
        for (const entry of yield* entries(dir)) {
          if (entry.type === "task") yield* readTask(entry.path, list, id);
          else if (entry.type === "list") {
            report("list-in-task", entry.path, "This folder has list.md inside a task");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "both") {
            report("both-markers", entry.path, "This folder has both task.md and list.md");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "file" && conflictCopyOf(entry.name) === TASK_FILE) {
            strays.push({ file: entry.path, kind: "conflict-copy", copyOf: file });
            yield* takeIdsUnder(entry.path);
          }
        }
      });

    const readList = (
      dir: string,
      list: string | null,
    ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
      Effect.gen(function* () {
        const children: Array<{ name: string; path: string; order: string; list: List }> = [];
        for (const entry of yield* entries(dir)) {
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
            yield* readTask(entry.path, list, null);
          } else if (entry.type === "both") {
            report("both-markers", entry.path, "This folder has both task.md and list.md");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "folder") {
            if ((yield* attempt(entry.path, oldLayoutFolder(entry.path))) !== null)
              legacyFolders.push(path.basename(entry.path));
            else
              report("unmarked-folder", entry.path, "This folder has neither task.md nor list.md");
            yield* takeIdsUnder(entry.path);
          } else if (listDepth(list) >= MAX_LIST_DEPTH) {
            report("list-too-deep", entry.path, `This list is ${listDepth(list) + 1} levels deep`);
            yield* takeIdsUnder(entry.path);
          } else {
            const file = path.join(entry.path, LIST_FILE);
            const text = yield* attempt(file, fs.readFileString(file));
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
          yield* readList(child.path, child.list.id);
        }
      });

    yield* readList(tasksDir, null);

    // Files made by hand or by another tool get an id the first time the app sees them.
    if (options.assignIds && missingId.length > 0) {
      const nextOnDisk = Effect.map(
        scanWorkspace(id, root, { assignIds: false }),
        (scan) => scan.nextIdNumber,
      );
      const unwritten = (dir: string, error: unknown) => {
        if (!isNotFound(error))
          report(
            "missing-id",
            path.join(dir, TASK_FILE),
            `This task has no id and writing one failed: ${String(error)}`,
            { field: "id" },
          );
      };
      const assignedAny = yield* Effect.gen(function* () {
        let assigned = false;
        const ids = yield* claimIds(
          tasksDir,
          config.key,
          highestId + 1,
          missingId.length,
          nextOnDisk,
        );
        for (const [index, dir] of missingId.entries()) {
          const given = yield* giveId(dir, ids[index]!).pipe(
            Effect.catch((error) =>
              Effect.sync(() => unwritten(dir, error)).pipe(Effect.as(undefined)),
            ),
          );
          if (given === undefined) continue;
          assigned = true;
          if (given !== null)
            yield* Effect.logInfo(`Assigned ${given} to ${rel(path.join(dir, TASK_FILE))}`);
        }
        return assigned;
      }).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          Effect.sync(() => {
            for (const dir of missingId) unwritten(dir, error);
            return false;
          }),
        ),
      );
      // Every file it settled now has an id, written here or by another process: read them back.
      if (assignedAny) return yield* scanWorkspace(id, root);
    }

    for (const stray of strays) yield* reportStray(stray);
    if (legacyFolders.length > 0) {
      report(
        "old-layout",
        tasksDir,
        `This workspace has folders from the old layout (${legacyFolders.slice(0, 3).join(", ")}${legacyFolders.length > 3 ? ", ..." : ""})`,
      );
    }
    for (const task of taskFiles) {
      if (statuses.some((known) => known.id === task.status)) continue;
      statuses.push({ id: task.status, name: humanize(task.status), category: "unstarted" });
      report(
        "unknown-status",
        path.join(root, task.path),
        `The status "${task.status}" is not in config.json`,
        {
          field: "status",
        },
      );
    }

    const compare = compareTasks(config.key);
    const { tasks, diagnostics: linkDiagnostics } = linkTasks(
      taskFiles.toSorted(compare),
      statuses,
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
      nextIdNumber: highestId + 1,
      oldLayout: legacyFolders.length > 0,
    };
  });
