import { Effect, PlatformError, Result } from "effect";
import { join, relative } from "node:path";
import {
  DEFAULT_STATUSES,
  type Diagnostic,
  type DiagnosticKind,
  type List,
  type WorkspaceSnapshot,
} from "./domain.ts";
import { isNotFound } from "./storage/files.ts";
import {
  CONFIG_FILE,
  LIST_FILE,
  TASK_FILE,
  TASKS_DIR,
  defaultStatus,
  humanize,
  idNumber,
} from "./layout.ts";
import { frontmatterId, hasFrontmatter, readFrontmatter } from "./frontmatter.ts";
import { diagnostic, type DiagnosticOptions } from "./health/problems.ts";
import { readListFile } from "./lists/list-file.ts";
import { compareOrder, compareTasks } from "./place.ts";
import { shownStatuses } from "./statuses/statuses.ts";
import { linkTasks } from "./tasks/links.ts";
import {
  readTaskFile,
  type TaskFile,
  type TaskFileRead,
  type TaskPlace,
} from "./tasks/task-file.ts";
import type { StorageRead } from "./storage/storage.ts";
import { markdownTexts, type ListFolder, type TaskFolder, type Tree } from "./storage/tree.ts";

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
  /** What the scan read, as the folder grammar has it. */
  readonly tree: Tree;
}

type Read<A> = Result.Result<A, PlatformError.PlatformError>;

/**
 * Each `task.md` text's parse at its place, kept while the tree reader keeps the text: a text it
 * reads again is a new object.
 */
const parsedTasks = new WeakMap<
  Read<string>,
  { readonly place: string; readonly read: TaskFileRead }
>();

const parseTask = (file: Read<string>, text: string, place: TaskPlace): TaskFileRead => {
  const key = JSON.stringify(place);
  const kept = parsedTasks.get(file);
  if (kept?.place === key) return kept.read;
  const read = readTaskFile(text, place);
  parsedTasks.set(file, { place: key, read });
  return read;
};

/** The text of every markdown file in the task folder and under it. */
const markdownIn = (folder: TaskFolder): Array<string> => [
  ...(Result.isSuccess(folder.file) ? [folder.file.success] : []),
  ...(Result.isSuccess(folder.children) ? folder.children.success : []).flatMap((child) =>
    child.type === "task"
      ? markdownIn(child)
      : child.type === "unread"
        ? child.markdown
        : Result.isSuccess(child.text)
          ? [child.text.success]
          : [],
  ),
];

/** Parses what storage read: folders with `task.md` are tasks, folders with `list.md` lists. */
export const scanWorkspace = (
  id: string,
  root: string,
  { config: { config, fallback, problems: configProblems }, tree }: StorageRead,
): Scan => {
  const tasksDir = join(root, TASKS_DIR);
  const rel = (absolute: string) => relative(root, absolute);
  const diagnostics: Array<Diagnostic> = [];
  const report = <K extends DiagnosticKind>(
    kind: K,
    absolute: string,
    detail: string,
    options?: DiagnosticOptions<K>,
  ) => diagnostics.push(diagnostic(kind, rel(absolute), detail, options));
  /** What a read got, or null after reporting why it got nothing. */
  const readAhead = <A>(
    absolute: string,
    result: Read<A>,
    failure = "Could not read it",
  ): A | null => {
    if (Result.isSuccess(result)) return result.success;
    if (!isNotFound(result.failure))
      report("unreadable", absolute, `${failure}: ${String(result.failure)}`);
    return null;
  };

  for (const { kind, detail, field } of configProblems)
    report(kind, join(tasksDir, CONFIG_FILE), detail, { field });
  const configured = config.statuses ?? DEFAULT_STATUSES;
  const fallbackStatus = defaultStatus(configured)?.id ?? "todo";

  const lists: Array<List> = [];
  const taskFiles: Array<TaskFile> = [];
  const listDirs = new Map<string, { dir: string; order: string }>();
  const taskDirs = new Map<string, string>();
  const taskTexts = new Map<string, string>();
  const missingId: Array<string> = [];
  /** Markdown files loose in a list, which are not tasks. */
  const strays: Array<{ file: string; text: string }> = [];
  let highestId = 0;
  const idsOnDisk = new Set<string>();
  const takeId = (taskId: string | null) => {
    if (taskId === null) return;
    idsOnDisk.add(taskId);
    highestId = Math.max(highestId, idNumber(taskId, config.key) ?? 0);
  };
  const takeIds = (texts: ReadonlyArray<string>) => {
    for (const text of texts) takeId(frontmatterId(text));
  };

  /**
   * A markdown file that is not a task. One that matches the task its id names byte for byte is
   * what an interrupted `wrap-as-task` leaves; the rest can become tasks when their frontmatter
   * parses.
   */
  const reportStray = ({ file, text }: (typeof strays)[number]) => {
    if (!hasFrontmatter(text)) {
      report("note", file, "This markdown file has no frontmatter, so it is read as a note");
      return;
    }
    const named = frontmatterId(text);
    const twinDir = named === null ? undefined : taskDirs.get(named);
    const identical = twinDir !== undefined && taskTexts.get(named!) === text;
    const parses = !("error" in readFrontmatter(text));
    const same = identical ? `, the same as ${rel(join(twinDir, TASK_FILE))}` : "";
    const broken = parses ? "" : ", and its frontmatter does not parse";
    report("loose-markdown", file, `This markdown file is not in a task folder${same}${broken}`, {
      fix: identical ? "remove-copy" : parses ? "wrap-as-task" : null,
    });
  };

  interface Waiting {
    readonly folder: TaskFolder;
    readonly text: string;
    readonly list: string | null;
    readonly read: Exclude<TaskFileRead, { _tag: "Invalid" }>;
  }
  /** Task folders read, waiting to be served. Of several with one id, the first is the task. */
  const waiting: Array<Waiting> = [];

  const readTask = (folder: TaskFolder, list: string | null, parent: string | null) => {
    const file = join(folder.path, TASK_FILE);
    const text = readAhead(
      file,
      folder.file,
      `Could not read it; this task and its subtasks are not read`,
    );
    if (text === null) return;
    const read = parseTask(folder.file, text, {
      list,
      parent,
      path: rel(file),
      folder: folder.name,
      defaultStatus: fallbackStatus,
      updated: folder.updated === null ? null : folder.updated.toISOString(),
      key: config.key,
    });
    if (read._tag === "Invalid") {
      const { kind, field, detail } = read.problem;
      report(kind, file, `${detail}; this task and its subtasks are not read`, { field });
      takeIds(markdownIn(folder));
      return;
    }
    waiting.push({ folder, text, list, read });
  };

  const serveTask = ({ folder, text, list, read }: Waiting) => {
    const file = join(folder.path, TASK_FILE);
    let id: string | null = null;
    if (read._tag === "MissingId") {
      missingId.push(folder.path);
      report("missing-id", file, "This task has no id yet", { field: "id" });
    } else if (taskDirs.has(read.value.id)) {
      const original = taskDirs.get(read.value.id)!;
      report(
        "duplicate-id",
        file,
        `The task ${rel(original)} already has the id ${read.value.id}`,
        { field: "id" },
      );
      takeIds(markdownIn(folder));
      return;
    } else {
      id = read.value.id;
      takeId(id);
      taskDirs.set(id, folder.path);
      taskTexts.set(id, text);
      taskFiles.push(read.value);
      for (const problem of read.problems) report(problem.kind, file, problem.detail, problem);
      if (idNumber(id, config.key) === null)
        report("foreign-id", file, `The id ${id} does not use the workspace key ${config.key}`, {
          field: "id",
        });
    }
    for (const child of readAhead(folder.path, folder.children) ?? []) {
      if (child.type === "task") readTask(child, list, id);
      else if (child.type === "unread") {
        report(child.problem.kind, child.path, child.problem.detail);
        takeIds(child.markdown);
      }
    }
  };

  const readList = (folder: Tree | ListFolder, list: string | null) => {
    const children: Array<{ name: string; order: string; folder: ListFolder; list: List }> = [];
    for (const child of readAhead(folder.path, folder.children) ?? []) {
      if (child.type === "unread") {
        report(child.problem.kind, child.path, child.problem.detail);
        takeIds(child.markdown);
      } else if (child.type === "markdown") {
        if (Result.isFailure(child.text)) continue;
        const text = child.text.success;
        strays.push({ file: child.path, text });
        takeId(frontmatterId(text));
      } else if (child.type === "task") {
        readTask(child, list, null);
      } else {
        const file = join(child.path, LIST_FILE);
        const text = readAhead(file, child.file);
        const read = text === null ? null : readListFile(text);
        if (read?._tag === "Invalid")
          report(
            read.problem.kind,
            file,
            `${read.problem.detail}; the list reads with its folder name`,
          );
        const listFile = read?._tag === "Read" ? read.value : null;
        const listId = list === null ? child.name : `${list}/${child.name}`;
        children.push({
          name: child.name,
          order: listFile?.order ?? "",
          folder: child,
          list: {
            id: listId,
            name: listFile?.name ?? humanize(child.name),
            parent: list,
            folder: relative(tasksDir, child.path),
          },
        });
      }
    }
    for (const child of children.toSorted(compareOrder)) {
      lists.push(child.list);
      listDirs.set(child.list.id, { dir: child.folder.path, order: child.order });
      readList(child.folder, child.list.id);
    }
  };

  readList(tree, null);
  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) serveTask(next);

  for (const stray of strays) reportStray(stray);
  const { statuses, unknown } = shownStatuses(configured, taskFiles);
  for (const task of unknown) {
    report(
      "unknown-status",
      join(root, task.path),
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
      statuses,
      lists,
      tasks,
      diagnostics,
    },
    dirs: { lists: listDirs, tasks: taskDirs },
    idsOnDisk,
    nextIdNumber: highestId + 1,
    missingId,
    tree,
  };
};

/** The text the scan read of the markdown file `file`, so a write edits what was read. */
export const fileText = (scan: Scan, file: string): Effect.Effect<string, Error> => {
  const text = markdownTexts(scan.tree).get(file);
  return text === undefined
    ? Effect.fail(new Error(`${relative(scan.snapshot.workspace.root, file)} was not read`))
    : Effect.succeed(text);
};
