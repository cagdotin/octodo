import { Effect, PlatformError, Result } from "effect";
import { join, relative } from "node:path";
import {
  CONFIG_FILE,
  LIST_FILE,
  OCTODO_DIR,
  TASK_FILE,
  TASKS_SECTION,
  folderIdNumber,
  idNumber,
} from "./layout.ts";
import {
  DEFAULT_STATUSES,
  type Diagnostic,
  type CoreDiagnosticKind,
  type Entry,
  type List,
  type WorkspaceSnapshot,
} from "@octodo/contract";
import { defaultStatus, humanize } from "@octodo/contract/rules";
import { isNotFound } from "./storage/files.ts";
import { frontmatterId, hasFrontmatter, readFrontmatter } from "./frontmatter.ts";
import { diagnostic, kindDiagnostic, type DiagnosticOptions } from "./health/problems.ts";
import { readEntryFile } from "./entries/entry-file.ts";
import { applyKind, enabledPlugins, readOwn } from "./plugins/kinds.ts";
import type { Plugin } from "./plugins/plugin.ts";
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
import {
  markdownTexts,
  type EntryFolder,
  type ListFolder,
  type SectionFolder,
  type TaskFolder,
  type TasksFolder,
  type Tree,
  type Unread,
} from "./storage/tree.ts";

/** A snapshot plus where its lists and tasks are on disk, which is nobody else's business. */
export interface Scan {
  readonly snapshot: WorkspaceSnapshot;
  readonly dirs: {
    /** Each list's absolute folder and the order key from its `list.md`, null when it does not read. */
    readonly lists: ReadonlyMap<string, { readonly dir: string; readonly order: string | null }>;
    /** Each task's absolute folder. */
    readonly tasks: ReadonlyMap<string, string>;
    /** Each entry's absolute folder, in the sections the workspace enables. */
    readonly entries: ReadonlyMap<string, string>;
  };
  /**
   * Every id a markdown file on disk has outside sections' entries, in tasks read or not: links to
   * them are not broken.
   */
  readonly idsOnDisk: ReadonlySet<string>;
  /** The number of the next new id: past every id on disk, in every section, read or not. */
  readonly nextIdNumber: number;
  /** Each `task.md` or entry marker file that has no id yet, each reported as `missing-id`. */
  readonly missingId: ReadonlyArray<string>;
  /** What the scan read, as the folder grammar has it. */
  readonly tree: Tree;
  /** The text of each plugin file of each task of a plugin's kind or entry, by id and file name. */
  readonly kindFiles: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The `type` each task's frontmatter names, by task id, whether the workspace enables it or not. */
  readonly types: ReadonlyMap<string, string>;
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
  installed: ReadonlyArray<Plugin> = [],
): Scan => {
  const configFile = join(root, OCTODO_DIR, CONFIG_FILE);
  const tasksDir = join(root, OCTODO_DIR, TASKS_SECTION);
  const rel = (absolute: string) => relative(root, absolute);
  const diagnostics: Array<Diagnostic> = [];
  const report = <K extends CoreDiagnosticKind>(
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

  for (const { kind, detail, field } of configProblems) report(kind, configFile, detail, { field });
  const configured = config.statuses ?? DEFAULT_STATUSES;
  const fallbackStatus = defaultStatus(configured)?.id ?? "todo";
  const { enabled, unknown: unknownPlugins } = enabledPlugins(installed, config.plugins);
  for (const plugin of unknownPlugins)
    report(
      "invalid-config",
      configFile,
      `The plugin ${JSON.stringify(plugin)} is not one octodo has, so it is ignored`,
      { field: "plugins" },
    );

  const lists: Array<List> = [];
  const taskFiles: Array<TaskFile> = [];
  const kindFiles = new Map<string, ReadonlyMap<string, string>>();
  const types = new Map<string, string>();
  const listDirs = new Map<string, { dir: string; order: string | null }>();
  const taskDirs = new Map<string, string>();
  const entryDirs = new Map<string, string>();
  const entries: Array<Omit<Entry, "mentionedIn">> = [];
  /** The ids in sections' folders, read or not, which a link to a task cannot name. */
  const sectionIds = new Set<string>();
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
   * The ids in a task folder whose `task.md` is not read: those its markdown files have, and as a
   * floor for new ids, the one its `<id>-<slug>` name gives, in case `task.md` holds it.
   */
  const takeUnreadTask = (folder: TaskFolder) => {
    takeIds(markdownIn(folder));
    highestId = Math.max(highestId, folderIdNumber(folder.name, config.key) ?? 0);
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
    if (text === null) {
      takeUnreadTask(folder);
      return;
    }
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
      takeUnreadTask(folder);
      return;
    }
    waiting.push({ folder, text, list, read });
  };

  const serveTask = ({ folder, text, list, read }: Waiting) => {
    const file = join(folder.path, TASK_FILE);
    let id: string | null = null;
    if (read._tag === "MissingId") {
      missingId.push(file);
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
      const type = read.frontmatter["type"];
      if (typeof type === "string") types.set(id, type);
      const kind = applyKind(read.value, read.frontmatter, (plugin) => ownFiles(folder, plugin), {
        installed,
        enabled,
      });
      taskFiles.push(kind.task);
      for (const problem of [...read.problems, ...kind.problems])
        report(problem.kind, file, problem.detail, problem);
      if (kind.plugin !== null) {
        kindFiles.set(id, kind.files);
        for (const problem of kind.kindProblems)
          diagnostics.push(
            kindDiagnostic(
              kind.plugin.shared,
              problem,
              rel(problem.file === undefined ? file : join(folder.path, problem.file)),
            ),
          );
      }
      if (idNumber(id, config.key) === null)
        report("foreign-id", file, `The id ${id} does not use the workspace key ${config.key}`, {
          field: "id",
        });
    }
    for (const child of readAhead(folder.path, folder.children) ?? []) {
      if (child.type === "task") readTask(child, list, id);
      else if (child.type === "unread") reportUnread(child);
    }
  };

  /** The text of each of `plugin`'s files the folder has, by name. */
  const ownFiles = (folder: TaskFolder | EntryFolder, plugin: Plugin) => {
    const texts = new Map<string, string>();
    for (const [name, read] of folder.owned) {
      if (!plugin.shared.files.includes(name)) continue;
      const content = readAhead(join(folder.path, name), read);
      if (content !== null) texts.set(name, content);
    }
    return texts;
  };

  const reportUnread = (child: Unread) => {
    report(child.problem.kind, child.path, child.problem.detail);
    takeIds(child.markdown);
  };

  const readList = (folder: TasksFolder | ListFolder, list: string | null) => {
    const children: Array<{
      name: string;
      order: string;
      readable: boolean;
      folder: ListFolder;
      list: List;
    }> = [];
    for (const child of readAhead(folder.path, folder.children) ?? []) {
      if (child.type === "unread") reportUnread(child);
      else if (child.type === "markdown") {
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
          readable: listFile !== null,
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
      listDirs.set(child.list.id, {
        dir: child.folder.path,
        order: child.readable ? child.order : null,
      });
      readList(child.folder, child.list.id);
    }
  };

  /** The ids in an entry folder whose marker file is not read, as `takeUnreadTask` takes them. */
  const takeUnreadEntry = (folder: EntryFolder) => {
    if (Result.isSuccess(folder.file)) takeIds([folder.file.success]);
    highestId = Math.max(highestId, folderIdNumber(folder.name, config.key) ?? 0);
  };

  const readEntry = (folder: EntryFolder, plugin: Plugin, marker: string) => {
    const file = join(folder.path, marker);
    const text = readAhead(file, folder.file, "Could not read it; this entry is not read");
    if (text === null) return takeUnreadEntry(folder);
    const read = readEntryFile(text, {
      path: rel(file),
      folder: folder.name,
      updated: folder.updated === null ? null : folder.updated.toISOString(),
      key: config.key,
    });
    if (read._tag === "Invalid") {
      const { kind, field, detail } = read.problem;
      report(kind, file, `${detail}; this entry is not read`, { field });
      return takeUnreadEntry(folder);
    }
    if (read._tag === "MissingId") {
      missingId.push(file);
      report("missing-id", file, "This entry has no id yet", { field: "id" });
      return;
    }
    const { value } = read;
    const original = taskDirs.get(value.id) ?? entryDirs.get(value.id);
    if (original !== undefined) {
      report("duplicate-id", file, `${rel(original)} already has the id ${value.id}`, {
        field: "id",
        fix: null,
      });
      return takeIds([text]);
    }
    takeId(value.id);
    entryDirs.set(value.id, folder.path);
    const files = ownFiles(folder, plugin);
    const { extra, fields, problems } = readOwn(plugin, value, read.frontmatter, files);
    entries.push({ ...value, extra, section: plugin.shared.id, fields });
    kindFiles.set(value.id, files);
    for (const problem of problems)
      diagnostics.push(
        kindDiagnostic(
          plugin.shared,
          problem,
          rel(problem.file === undefined ? file : join(folder.path, problem.file)),
        ),
      );
    if (idNumber(value.id, config.key) === null)
      report(
        "foreign-id",
        file,
        `The id ${value.id} does not use the workspace key ${config.key}`,
        {
          field: "id",
        },
      );
  };

  /** A section's entries; only their ids when the workspace does not enable its plugin. */
  const readSection = (folder: SectionFolder) => {
    const plugin = enabled.find((candidate) => candidate.shared.id === folder.name);
    const children =
      plugin === undefined
        ? Result.isSuccess(folder.children)
          ? folder.children.success
          : []
        : (readAhead(folder.path, folder.children) ?? []);
    const before = new Set(idsOnDisk);
    for (const child of children) {
      if (plugin === undefined) {
        if (child.type === "unread") takeIds(child.markdown);
        else takeUnreadEntry(child);
      } else if (child.type === "unread") reportUnread(child);
      else readEntry(child, plugin, folder.marker);
    }
    for (const taken of idsOnDisk) if (!before.has(taken)) sectionIds.add(taken);
  };

  const sections: Array<SectionFolder> = [];
  for (const child of readAhead(tree.path, tree.children) ?? []) {
    if (child.type === "tasks") readList(child, null);
    else if (child.type === "section") sections.push(child);
    else reportUnread(child);
  }
  for (let next = waiting.shift(); next !== undefined; next = waiting.shift()) serveTask(next);
  for (const section of sections) readSection(section);

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
  const linkable = new Set([...idsOnDisk].filter((onDisk) => !sectionIds.has(onDisk)));
  const linked = linkTasks(
    taskFiles.toSorted(compare),
    statuses,
    linkable,
    entries.toSorted(compare),
  );
  diagnostics.push(...linked.diagnostics);
  return {
    snapshot: {
      workspace: { id, name: config.name, key: config.key, root },
      statuses,
      lists,
      tasks: linked.tasks,
      ...(linked.entries.length === 0 ? {} : { entries: linked.entries }),
      diagnostics,
      ...(enabled.length === 0 ? {} : { plugins: enabled.map((plugin) => plugin.shared.id) }),
    },
    dirs: { lists: listDirs, tasks: taskDirs, entries: entryDirs },
    idsOnDisk: linkable,
    nextIdNumber: highestId + 1,
    missingId,
    tree,
    kindFiles,
    types,
  };
};

/** The text the scan read of the markdown file `file`, so a write edits what was read. */
export const fileText = (scan: Scan, file: string): Effect.Effect<string, Error> => {
  const text = markdownTexts(scan.tree).get(file);
  return text === undefined
    ? Effect.fail(new Error(`${relative(scan.snapshot.workspace.root, file)} was not read`))
    : Effect.succeed(text);
};
