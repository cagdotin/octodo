import { Effect, FileSystem, Option, Path, Schema } from "effect";
import {
  DEFAULT_STATUSES,
  WorkspaceConfig,
  type Diagnostic,
  type List,
  type StatusDefinition,
  type Task,
  type WorkspaceSnapshot,
} from "./domain.ts";
import { isNotFound } from "./files.ts";
import {
  CONFIG_FILE,
  LIST_FILE,
  MAX_LIST_DEPTH,
  TASK_FILE,
  TASKS_DIR,
  defaultStatus,
  deriveKey,
  humanize,
  idNumber,
  listDepth,
  sortStatuses,
} from "./layout.ts";
import { linkTasks, type ReadTask } from "./links.ts";
import { oldLayoutFolder } from "./migrate.ts";
import { frontmatterId, readListFile, readTaskFile } from "./markdown.ts";
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
    const report = (absolute: string, message: string) =>
      diagnostics.push({ path: rel(absolute), message });
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
        if (!isNotFound(error)) report(absolute, `${failure}: ${String(error)}`);
        return Effect.succeed(null);
      });

    const config = yield* fs.readFileString(path.join(tasksDir, CONFIG_FILE)).pipe(
      Effect.flatMap(decodeConfig),
      Effect.catch((error) => {
        diagnostics.push({ path: path.join(TASKS_DIR, CONFIG_FILE), message: String(error) });
        const name = humanize(path.basename(root));
        return Effect.succeed<WorkspaceConfig>({ name, key: deriveKey(name) });
      }),
    );
    const statuses: Array<StatusDefinition> = [...(config.statuses ?? DEFAULT_STATUSES)];
    const fallbackStatus = defaultStatus(statuses)?.id ?? "todo";

    const lists: Array<List> = [];
    const taskFiles: Array<ReadTask> = [];
    const listDirs = new Map<string, { dir: string; order: string }>();
    const taskDirs = new Map<string, string>();
    const missingId: Array<string> = [];
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
          report(file, `${read.message}; this task and its subtasks are not read`);
          yield* takeIdsUnder(dir);
          return;
        }
        let id: string | null = null;
        if (read._tag === "MissingId") {
          missingId.push(dir);
          takeId(yield* pendingId(dir));
        } else if (taskDirs.has(read.value.id)) {
          report(
            file,
            `Duplicate task id ${read.value.id}; this copy and its subtasks are ignored`,
          );
          yield* takeIdsUnder(dir);
          return;
        } else {
          id = read.value.id;
          takeId(id);
          taskDirs.set(id, dir);
          taskFiles.push({ task: read.value, malformedLinks: read.malformedLinks });
        }
        for (const entry of yield* entries(dir)) {
          if (entry.type === "task") yield* readTask(entry.path, list, id);
          else if (entry.type === "list") {
            report(entry.path, "A list cannot sit inside a task; it is not read");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "both") {
            report(entry.path, "Folder has both task.md and list.md; it is not read");
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
              report(entry.path, "Markdown file is not a task; a task is a folder with task.md");
              yield* takeIdsUnder(entry.path);
            }
          } else if (entry.type === "task") {
            yield* readTask(entry.path, list, null);
          } else if (entry.type === "both") {
            report(entry.path, "Folder has both task.md and list.md; it is not read");
            yield* takeIdsUnder(entry.path);
          } else if (entry.type === "folder") {
            if ((yield* attempt(entry.path, oldLayoutFolder(entry.path))) !== null)
              legacyFolders.push(path.basename(entry.path));
            else report(entry.path, "Folder has neither task.md nor list.md; it is not read");
            yield* takeIdsUnder(entry.path);
          } else if (listDepth(list) >= MAX_LIST_DEPTH) {
            report(
              entry.path,
              `Lists nest at most ${MAX_LIST_DEPTH} levels deep; this one is not read`,
            );
            yield* takeIdsUnder(entry.path);
          } else {
            const file = path.join(entry.path, LIST_FILE);
            const text = yield* attempt(file, fs.readFileString(file));
            const read = text === null ? null : readListFile(text);
            if (read?._tag === "Invalid") report(file, read.message);
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
          const file = path.join(dir, TASK_FILE);
          const given = yield* attempt(
            file,
            giveId(dir, ids[index]!),
            "Could not give it an id; it is not read",
          );
          if (given === null) continue;
          assigned = true;
          yield* Effect.logInfo(`Assigned ${given} to ${rel(file)}`);
        }
        return assigned;
      }).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          Effect.sync(() => {
            report(
              tasksDir,
              `Could not claim ids for new tasks; they are not read: ${String(error)}`,
            );
            return false;
          }),
        ),
      );
      // Assigning ids rewrites files, so the scan repeats to read them back.
      if (assignedAny) return yield* scanWorkspace(id, root);
    }

    if (legacyFolders.length > 0) {
      diagnostics.push({
        path: TASKS_DIR,
        message: `This workspace has folders from the old layout (${legacyFolders.slice(0, 3).join(", ")}${legacyFolders.length > 3 ? ", ..." : ""}), which are not read. Run \`octo migrate\` to convert them.`,
      });
    }
    for (const { task } of taskFiles) {
      if (statuses.some((known) => known.id === task.status)) continue;
      statuses.push({ id: task.status, name: humanize(task.status), category: "unstarted" });
      report(
        path.join(root, task.path),
        `Status "${task.status}" is not in config.json; it is shown as an unstarted status`,
      );
    }

    const compare = compareTasks(config.key);
    const { tasks, diagnostics: linkDiagnostics } = linkTasks(
      taskFiles.toSorted((a, b) => compare(a.task, b.task)),
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
