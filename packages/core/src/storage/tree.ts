import { Effect, FileSystem, Option, Path, PlatformError, Result, Semaphore } from "effect";
import { sep } from "node:path";
import type { Problem } from "../domain.ts";
import { isNotFound } from "./files.ts";
import { LIST_FILE, MAX_LIST_DEPTH, TASK_FILE } from "../layout.ts";
import { isHidden } from "./bookkeeping.ts";
import { makeCache, type Cache } from "./cache.ts";

type Read<A> = Result.Result<A, PlatformError.PlatformError>;
type Platform = FileSystem.FileSystem | Path.Path;

/** The files that make a folder a task or a list, in lower case. */
export const MARKERS: ReadonlyArray<string> = [TASK_FILE, LIST_FILE];

/** A folder with `task.md`. Its files and folders that are none of its children are attachments. */
export interface TaskFolder {
  readonly type: "task";
  readonly name: string;
  readonly path: string;
  /** The text of its `task.md`. */
  readonly file: Read<string>;
  /** When `task.md` last changed. */
  readonly updated: Date | null;
  /** In name order. */
  readonly children: Read<ReadonlyArray<TaskChild>>;
}

/** A folder with `list.md`. */
export interface ListFolder {
  readonly type: "list";
  readonly name: string;
  readonly path: string;
  /** The text of its `list.md`. */
  readonly file: Read<string>;
  /** In name order. */
  readonly children: Read<ReadonlyArray<ListChild>>;
}

/** A markdown file in a task or list folder that is not the folder's own marker. */
export interface Markdown {
  readonly type: "markdown";
  readonly name: string;
  readonly path: string;
  readonly text: Read<string>;
}

/** What the grammar does not read, and the text of every markdown file under it. */
export interface Unread {
  readonly type: "unread";
  readonly path: string;
  readonly problem: Problem;
  readonly markdown: ReadonlyArray<string>;
}

export type TaskChild = TaskFolder | Markdown | Unread;
export type ListChild = TaskFolder | ListFolder | Markdown | Unread;

/** `.octodo/`, the root list. It has no `list.md`, so a `list.md` or `task.md` in it is markdown. */
export interface Tree {
  readonly path: string;
  readonly children: Read<ReadonlyArray<ListChild>>;
}

/** Reads the tree, reading only the paths that changed since the reads that filled it. */
export interface TreeReader extends Omit<Cache, "read"> {
  readonly read: (tasksDir: string) => Effect.Effect<Tree, never, Platform>;
}

/**
 * How many file system calls tree reads have in flight at once, across every workspace in the
 * process. A file read holds a descriptor across several calls.
 */
export const CALLS_AT_ONCE = 32;
const calls = Semaphore.makeUnsafe(CALLS_AT_ONCE);
const ENTRIES_AT_ONCE = 32;

type Symlink = { readonly type: "symlink"; readonly target: string };

/** A folder's `task.md` or `list.md`: a file with its text, or a link, which is not followed. */
type Marker =
  | Symlink
  | { readonly type: "file"; readonly text: Read<string>; readonly mtime: Date | null };

/** What a read finds at one path before it reads the folders inside it. */
type Node =
  | Symlink
  | { readonly type: "file" }
  | {
      readonly type: "folder";
      readonly names: Read<ReadonlyArray<string>>;
      /** Its `task.md` and `list.md`, null for one it does not have. */
      readonly task: Marker | null;
      readonly list: Marker | null;
    };

type Container =
  | { readonly kind: "task" }
  /** `depth` is how many lists deep the folder is: 0 for `.octodo/`. */
  | { readonly kind: "list"; readonly depth: number };

/** Whether `node` holds what is on disk until its path changes: it is there and every read worked. */
const settled = (node: Node | null): boolean =>
  node !== null &&
  (node.type !== "folder" ||
    (Result.isSuccess(node.names) &&
      [node.task, node.list].every(
        (marker) => marker?.type !== "file" || Result.isSuccess(marker.text),
      )));

/** Everything but a list, which a task folder reads as a problem. */
const isTaskChild = (child: ListChild): child is TaskChild => child.type !== "list";

const unread = (path: string, problem: Problem, markdown: ReadonlyArray<string> = []): Unread => ({
  type: "unread",
  path,
  problem,
  markdown,
});

const readWith = (tasksDir: string, cache: Cache): Effect.Effect<Tree, never, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const call = calls.withPermits(1);

    /** The marker file `file`, or null when the folder does not have it. */
    const readMarker = (names: Read<ReadonlyArray<string>>, file: string) =>
      Effect.gen(function* () {
        if (Result.isSuccess(names) && !names.success.includes(path.basename(file))) return null;
        const info = yield* call(fs.lstat(file)).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed(null)),
        );
        if (info === null) return null;
        if (info.type === "SymbolicLink")
          return { type: "symlink" as const, target: yield* call(fs.readLink(file)) };
        return {
          type: "file" as const,
          text: yield* Effect.result(call(fs.readFileString(file))),
          mtime: Option.getOrNull(info.mtime),
        };
      });

    const readNode = (at: string) =>
      Effect.gen(function* () {
        const info = yield* call(fs.lstat(at));
        if (info.type === "SymbolicLink")
          return { type: "symlink" as const, target: yield* call(fs.readLink(at)) };
        if (info.type === "File") return { type: "file" as const };
        if (info.type !== "Directory") return null;
        const names = yield* Effect.result(call(fs.readDirectory(at)));
        const task = yield* readMarker(names, path.join(at, TASK_FILE));
        const list = yield* readMarker(names, path.join(at, LIST_FILE));
        if (task === null && list === null) {
          // A folder that can be listed but not entered fails here, and is reported unreadable.
          yield* call(fs.exists(path.join(at, TASK_FILE)));
          yield* call(fs.exists(path.join(at, LIST_FILE)));
        }
        return { type: "folder" as const, names, task, list };
      });

    const nodeAt = (at: string) => cache.read(at, "node", readNode(at), settled);

    const markdownText = (file: string) =>
      Effect.result(cache.read(file, "text", call(fs.readFileString(file))));

    const visible = (names: ReadonlyArray<string>) =>
      names.filter((name) => !isHidden(name)).toSorted();

    /** The text of every markdown file in and under the folder `node` at `at`, links aside. */
    const markdownUnder = (at: string, node: Node | null): Effect.Effect<Array<string>> =>
      Effect.gen(function* () {
        if (node?.type !== "folder" || Result.isFailure(node.names)) return [];
        const own = [node.task, node.list].flatMap((marker) =>
          marker?.type === "file" && Result.isSuccess(marker.text) ? [marker.text.success] : [],
        );
        const inside = yield* Effect.forEach(
          visible(node.names.success),
          (name) =>
            Effect.gen(function* () {
              const child = path.join(at, name);
              const found = yield* nodeAt(child);
              if (found?.type === "folder") return yield* markdownUnder(child, found);
              if (found?.type !== "file" || !name.endsWith(".md") || MARKERS.includes(name))
                return [];
              const text = yield* markdownText(child);
              return Result.isSuccess(text) ? [text.success] : [];
            }).pipe(Effect.orElseSucceed((): Array<string> => [])),
          { concurrency: ENTRIES_AT_ONCE },
        );
        return [...own, ...inside.flat()];
      });

    /** The folder at `at` as unread, with the markdown under it. */
    const unreadFolder = (
      at: string,
      node: Node,
      kind: "both-markers" | "list-in-task" | "list-too-deep" | "unmarked-folder",
      detail: string,
    ) =>
      Effect.map(markdownUnder(at, node), (texts) =>
        unread(at, { kind, field: null, detail }, texts),
      );

    /** The folder at `at` as unread, its marker `name` being a link, with the markdown under it. */
    const linkedFolder = (at: string, node: Node, name: string, link: Symlink) =>
      Effect.map(markdownUnder(at, node), (texts) =>
        unread(
          path.join(at, name),
          { kind: "symlink", field: null, detail: `This is a link to ${link.target}` },
          texts,
        ),
      );

    /** The entry `name` in the folder `dir`, as `container` reads it; null for what it ignores. */
    const entry = (
      dir: string,
      name: string,
      container: Container,
    ): Effect.Effect<ListChild | null> => {
      const at = path.join(dir, name);
      return Effect.gen(function* () {
        const node = yield* nodeAt(at);
        if (node === null) return null;
        if (node.type === "symlink")
          return unread(at, {
            kind: "symlink",
            field: null,
            detail: `This is a link to ${node.target}`,
          });
        if (node.type === "file") {
          if (!name.endsWith(".md")) return null;
          return { type: "markdown" as const, name, path: at, text: yield* markdownText(at) };
        }
        const { task, list } = node;
        if (task !== null && list !== null)
          return yield* unreadFolder(
            at,
            node,
            "both-markers",
            "This folder has both task.md and list.md",
          );
        if (task?.type === "symlink") return yield* linkedFolder(at, node, TASK_FILE, task);
        if (list?.type === "symlink") return yield* linkedFolder(at, node, LIST_FILE, list);
        if (task !== null) {
          const children = yield* childrenOf(at, node.names, { kind: "task" });
          return {
            type: "task" as const,
            name,
            path: at,
            file: task.text,
            updated: task.mtime,
            children: Result.map(children, (found) => found.filter(isTaskChild)),
          };
        }
        if (container.kind === "task")
          return list === null
            ? null
            : yield* unreadFolder(
                at,
                node,
                "list-in-task",
                "This folder has list.md inside a task",
              );
        if (list === null)
          return yield* unreadFolder(
            at,
            node,
            "unmarked-folder",
            "This folder has neither task.md nor list.md",
          );
        if (container.depth >= MAX_LIST_DEPTH)
          return yield* unreadFolder(
            at,
            node,
            "list-too-deep",
            `This list is ${container.depth + 1} levels deep`,
          );
        const children = yield* childrenOf(at, node.names, {
          kind: "list",
          depth: container.depth + 1,
        });
        return { type: "list" as const, name, path: at, file: list.text, children };
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            isNotFound(error)
              ? null
              : unread(at, {
                  kind: "unreadable",
                  field: null,
                  detail: `Could not read it: ${String(error)}`,
                }),
          ),
        ),
      );
    };

    /** The children of the folder `dir`; a task's or list's own marker is not one. */
    const childrenOf = (
      dir: string,
      names: Read<ReadonlyArray<string>>,
      container: Container,
    ): Effect.Effect<Read<Array<ListChild>>> => {
      if (Result.isFailure(names)) return Effect.succeed(Result.fail(names.failure));
      const root = container.kind === "list" && container.depth === 0;
      const children = visible(names.success).filter((name) => root || !MARKERS.includes(name));
      return Effect.forEach(children, (name) => entry(dir, name, container), {
        concurrency: ENTRIES_AT_ONCE,
      }).pipe(Effect.map((found) => Result.succeed(found.filter((child) => child !== null))));
    };

    const names = yield* Effect.result(
      cache.read(tasksDir, "names", call(fs.readDirectory(tasksDir))),
    );
    const children = yield* childrenOf(tasksDir, names, { kind: "list", depth: 0 });
    return { path: tasksDir, children };
  });

export const makeTreeReader = (): TreeReader => {
  const cache = makeCache();
  return {
    read: (tasksDir) => readWith(tasksDir, cache),
    changed: cache.changed,
    clear: cache.clear,
    version: cache.version,
  };
};

const textsByTree = new WeakMap<Tree, ReadonlyMap<string, string>>();

/** The text of every `task.md`, `list.md` and other markdown file the tree read, by absolute path. */
export const markdownTexts = (tree: Tree): ReadonlyMap<string, string> => {
  const kept = textsByTree.get(tree);
  if (kept !== undefined) return kept;
  const texts = new Map<string, string>();
  const add = (file: string, text: Read<string>) => {
    if (Result.isSuccess(text)) texts.set(file, text.success);
  };
  const visit = (children: Tree["children"]) => {
    for (const child of Result.isSuccess(children) ? children.success : []) {
      if (child.type === "markdown") add(child.path, child.text);
      else if (child.type === "task" || child.type === "list") {
        add(`${child.path}${sep}${child.type === "task" ? TASK_FILE : LIST_FILE}`, child.file);
        visit(child.children);
      }
    }
  };
  visit(tree.children);
  textsByTree.set(tree, texts);
  return texts;
};

/** The task folders from `dir` down, parents before their subtasks; none when `dir` is not one. */
export const taskFoldersFrom = (tree: Tree, dir: string): Array<string> => {
  const find = (children: Tree["children"]): TaskFolder | undefined => {
    for (const child of Result.isSuccess(children) ? children.success : []) {
      if (child.type !== "task" && child.type !== "list") continue;
      if (child.path === dir) return child.type === "task" ? child : undefined;
      if (dir.startsWith(`${child.path}${sep}`)) return find(child.children);
    }
    return undefined;
  };
  const down = (folder: TaskFolder): Array<string> => [
    folder.path,
    ...(Result.isSuccess(folder.children) ? folder.children.success : []).flatMap((child) =>
      child.type === "task" ? down(child) : [],
    ),
  ];
  const found = find(tree.children);
  return found === undefined ? [] : down(found);
};
