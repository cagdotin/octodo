import { Effect, FileSystem, Option, Path, PlatformError, Result, Semaphore } from "effect";
import { sep } from "node:path";
import type { Problem } from "../diagnostics.ts";
import { isLeftover, isNotFound } from "../files.ts";
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
  /** The text of its `task.md`, read through a link. */
  readonly file: Read<string>;
  /** When `task.md` last changed; for a link, when its target did. */
  readonly updated: Date | null;
  /** In name order. */
  readonly children: Read<ReadonlyArray<TaskChild>>;
}

/** A folder with `list.md`. */
export interface ListFolder {
  readonly type: "list";
  readonly name: string;
  readonly path: string;
  /** The text of its `list.md`, read through a link. */
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

/** What a read finds at one path before it reads the folders inside it. */
type Node =
  | { readonly type: "symlink"; readonly target: string }
  | { readonly type: "file"; readonly mtime: Date | null }
  | {
      readonly type: "folder";
      readonly names: Read<ReadonlyArray<string>>;
      /** The text of its `task.md` or `list.md`, or null when it has none. */
      readonly task: Read<string> | null;
      readonly list: Read<string> | null;
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
      [node.task, node.list].every((read) => read === null || Result.isSuccess(read))));

/** Everything but a list, which a task folder reads as a problem. */
const isTaskChild = (child: ListChild): child is TaskChild => child.type !== "list";

const unread = (path: string, problem: Problem, markdown: ReadonlyArray<string> = []): Unread => ({
  type: "unread",
  path,
  problem,
  markdown,
});

const readWith = (
  tasksDir: string,
  cache: Cache | undefined,
): Effect.Effect<Tree, never, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const call = calls.withPermits(1);
    const kept = <A, E, R>(
      at: string,
      aspect: string,
      read: Effect.Effect<A, E, R>,
      keep?: (value: A) => boolean,
    ) => (cache === undefined ? read : cache.read(at, aspect, read, keep));

    /**
     * The marker file `file` read, or null when the folder does not have it. A failed read asks
     * `exists`, so a dangling link or an unlistable folder decides as it would.
     */
    const readMarker = (names: Read<ReadonlyArray<string>>, file: string) =>
      Effect.gen(function* () {
        if (Result.isSuccess(names) && !names.success.includes(path.basename(file))) return null;
        const result = yield* Effect.result(call(fs.readFileString(file)));
        if (Result.isSuccess(result)) return result;
        return (yield* call(fs.exists(file))) ? result : null;
      });

    const readNode = (at: string) =>
      Effect.gen(function* () {
        const info = yield* call(fs.lstat(at));
        if (info.type === "SymbolicLink")
          return { type: "symlink" as const, target: yield* call(fs.readLink(at)) };
        if (info.type === "File")
          return { type: "file" as const, mtime: Option.getOrNull(info.mtime) };
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

    /**
     * Whether the folder `at` has a marker that is a link: what a folder like that is follows its
     * targets, whose changes report no path in the workspace, so it is read anew each time.
     */
    const linksMarker = (at: string, names: Read<ReadonlyArray<string>>) =>
      Effect.forEach(
        MARKERS.filter((marker) => Result.isSuccess(names) && names.success.includes(marker)),
        (marker) => {
          const file = path.join(at, marker);
          return Effect.map(
            kept(file, "node", readNode(file), settled),
            (node) => node?.type === "symlink",
          );
        },
      ).pipe(Effect.map((links) => links.includes(true)));

    const nodeAt = (at: string) =>
      Effect.gen(function* () {
        const node = yield* kept(at, "node", readNode(at), settled);
        if (cache === undefined || node?.type !== "folder") return node;
        return (yield* linksMarker(at, node.names)) ? yield* readNode(at) : node;
      });

    const markdownText = (file: string) =>
      Effect.result(kept(file, "text", call(fs.readFileString(file))));

    const visible = (names: ReadonlyArray<string>) =>
      names.filter((name) => !isHidden(name)).toSorted();

    /** The text of every markdown file in and under the folder `node` at `at`, links aside. */
    const markdownUnder = (at: string, node: Node | null): Effect.Effect<Array<string>> =>
      Effect.gen(function* () {
        if (node?.type !== "folder" || Result.isFailure(node.names)) return [];
        const own = [node.task, node.list].flatMap((read) =>
          read !== null && Result.isSuccess(read) ? [read.success] : [],
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

    /** The entry `name` in the folder `dir`, as `container` reads it; null for what it ignores. */
    const entry = (
      dir: string,
      name: string,
      container: Container,
    ): Effect.Effect<ListChild | { readonly type: "marker"; readonly node: Node } | null> => {
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
          const root = container.kind === "list" && container.depth === 0;
          if (!root && MARKERS.includes(name)) return { type: "marker" as const, node };
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
        if (task !== null) {
          const { children, marker } = yield* childrenOf(at, node.names, { kind: "task" });
          const updated =
            marker?.type === "file" ? marker.mtime : yield* linkedTime(path.join(at, TASK_FILE));
          return {
            type: "task" as const,
            name,
            path: at,
            file: task,
            updated,
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
        const { children } = yield* childrenOf(at, node.names, {
          kind: "list",
          depth: container.depth + 1,
        });
        return { type: "list" as const, name, path: at, file: list, children };
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

    /** A `task.md` that is a link is dated by its target. */
    const linkedTime = (file: string) =>
      call(fs.stat(file)).pipe(
        Effect.map((info) => Option.getOrNull(info.mtime)),
        Effect.orElseSucceed(() => null),
      );

    /** The children of the folder `dir`, and the node of its own marker file when it is a file. */
    const childrenOf = (
      dir: string,
      names: Read<ReadonlyArray<string>>,
      container: Container,
    ): Effect.Effect<{
      readonly children: Read<Array<ListChild>>;
      readonly marker: Node | undefined;
    }> =>
      Result.isFailure(names)
        ? Effect.succeed({ children: Result.fail(names.failure), marker: undefined })
        : Effect.forEach(visible(names.success), (name) => entry(dir, name, container), {
            concurrency: ENTRIES_AT_ONCE,
          }).pipe(
            Effect.map((found) => ({
              children: Result.succeed(
                found.filter((child) => child !== null && child.type !== "marker"),
              ),
              marker: found.find((child) => child?.type === "marker")?.node,
            })),
          );

    const names = yield* Effect.result(kept(tasksDir, "names", call(fs.readDirectory(tasksDir))));
    const { children } = yield* childrenOf(tasksDir, names, { kind: "list", depth: 0 });
    return { path: tasksDir, children };
  });

/** Reads `.octodo/` at `tasksDir` by its folder grammar, without parsing a file. */
export const readTree = (tasksDir: string): Effect.Effect<Tree, never, Platform> =>
  readWith(tasksDir, undefined);

export const makeTreeReader = (): TreeReader => {
  const cache = makeCache();
  return {
    read: (tasksDir) => readWith(tasksDir, cache),
    changed: cache.changed,
    clear: cache.clear,
    version: cache.version,
  };
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

/**
 * Whether two folders hold the same names and bytes all the way down, hidden files included and
 * octodo's temporary files aside. A link is the same only as a link to the same place.
 */
export const sameTree = (
  a: string,
  b: string,
): Effect.Effect<boolean, PlatformError.PlatformError, Platform> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const [infoA, infoB] = [yield* fs.lstat(a), yield* fs.lstat(b)];
    if (infoA.type !== infoB.type) return false;
    if (infoA.type === "SymbolicLink") return (yield* fs.readLink(a)) === (yield* fs.readLink(b));
    if (infoA.type === "File") {
      const [bytesA, bytesB] = [yield* fs.readFile(a), yield* fs.readFile(b)];
      return bytesA.length === bytesB.length && bytesA.every((byte, i) => byte === bytesB[i]);
    }
    const kept = (names: ReadonlyArray<string>) =>
      names.filter((name) => !isLeftover(name)).toSorted();
    const [namesA, namesB] = [kept(yield* fs.readDirectory(a)), kept(yield* fs.readDirectory(b))];
    if (namesA.join("/") !== namesB.join("/")) return false;
    for (const name of namesA) {
      if (!(yield* sameTree(path.join(a, name), path.join(b, name)))) return false;
    }
    return true;
  });

/** `fs`, with every call that changes a path telling `reader` once the call is over. */
export const reportingChanges = (
  fs: FileSystem.FileSystem,
  reader: Pick<TreeReader, "changed">,
): FileSystem.FileSystem => {
  const changing =
    <Args extends ReadonlyArray<unknown>, A, E, R>(
      call: (...args: Args) => Effect.Effect<A, E, R>,
      changes: (...args: Args) => ReadonlyArray<string>,
    ) =>
    (...args: Args): Effect.Effect<A, E, R> =>
      Effect.ensuring(
        call(...args),
        Effect.sync(() => {
          for (const path of changes(...args)) reader.changed(path);
        }),
      );
  const one = (path: string) => [path];
  const both = (from: string, to: string) => [from, to];
  return {
    ...fs,
    chmod: changing(fs.chmod, one),
    chown: changing(fs.chown, one),
    copy: changing(fs.copy, both),
    copyFile: changing(fs.copyFile, both),
    link: changing(fs.link, both),
    makeDirectory: changing(fs.makeDirectory, one),
    remove: changing(fs.remove, one),
    rename: changing(fs.rename, both),
    symlink: changing(fs.symlink, both),
    truncate: changing(fs.truncate, one),
    utimes: changing(fs.utimes, one),
    writeFile: changing(fs.writeFile, one),
    writeFileString: changing(fs.writeFileString, one),
  };
};
