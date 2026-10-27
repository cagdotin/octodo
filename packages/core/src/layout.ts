/**
 * Plain functions with no Effect code, so the browser can import this module on its own
 * (`@octodo/core/layout`) without pulling the runtime in.
 *
 * The on-disk grammar of a workspace. A folder with `task.md` is a task, and the task folders
 * inside it are its subtasks. A folder with `list.md` is a list. `.octodo/` is the root. Folder
 * names mean nothing to the scanner: a task folder is named `<id>-<slug>` and a list folder is its
 * slug for people reading the tree, and a list's id is its folder names joined by `/`.
 */
import type { List, StatusCategory, StatusDefinition, Task } from "./domain.ts";

export const TASKS_DIR = ".octodo";
export const CONFIG_FILE = "config.json";
export const TASK_FILE = "task.md";
export const LIST_FILE = "list.md";
/** How deep lists nest: a top-level list, its sublists and theirs. */
export const MAX_LIST_DEPTH = 3;

/**
 * What a status can mean. Statuses are ordered by it: categories always come in this order, and
 * only the statuses inside one category are ordered by the user.
 */
export const STATUS_CATEGORIES = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "archived",
] as const;

const CLOSED_CATEGORIES: ReadonlyArray<StatusCategory> = ["completed", "canceled", "archived"];

/** Whether tasks in this category are finished or out of the way. */
export const isClosedCategory = (category: StatusCategory | undefined): boolean =>
  category !== undefined && CLOSED_CATEGORIES.includes(category);

const categoryIndex = (status: StatusDefinition) => STATUS_CATEGORIES.indexOf(status.category);

/** Statuses in workflow order: by category, keeping the given order within each category. */
export const sortStatuses = (statuses: ReadonlyArray<StatusDefinition>): Array<StatusDefinition> =>
  statuses.toSorted((a, b) => categoryIndex(a) - categoryIndex(b));

/** The status new tasks land in: the first unstarted one, else the first in workflow order. */
export const defaultStatus = (
  statuses: ReadonlyArray<StatusDefinition>,
): StatusDefinition | undefined =>
  statuses.find((status) => status.category === "unstarted") ?? sortStatuses(statuses)[0];

/** A folder of the layout before tasks were folders: `s01-todo` (a status) or `l00-groceries` (a list). */
export const legacyFolder = (
  name: string,
): {
  readonly type: "status" | "list";
  readonly slug: string;
  readonly position: number | null;
} | null => {
  const match = /^([sl])(\d*)-(.+)$/.exec(name);
  if (match === null) return null;
  const [, prefix, digits, slug] = match;
  return {
    type: prefix === "s" ? "status" : "list",
    slug: slug!,
    position: digits === "" ? null : Number(digits),
  };
};

export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const humanize = (slug: string): string =>
  slug
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Derives a Linear-style key from a project name: the initials of a multi-word name
 * (`house-move` → `HM`), or the first three letters of a single word (`garden` → `GAR`).
 */
export const deriveKey = (name: string): string => {
  const words = slugify(name)
    .split("-")
    .filter((word) => /[a-z]/.test(word));
  if (words.length === 0) return "TASK";
  if (words.length === 1)
    return words[0]!
      .replace(/[^a-z]/g, "")
      .slice(0, 3)
      .toUpperCase();
  return words
    .map((word) => word.replace(/[^a-z]/g, "")[0] ?? "")
    .join("")
    .slice(0, 5)
    .toUpperCase();
};

/** Whether `id` has the shape of a task id: a key, a dash and a number, as in `HM-42`. */
export const isTaskId = (id: string): boolean => /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id);

/**
 * The name a sync tool's conflict copy was made from: iCloud names a second copy of `task.md`
 * `task 2.md` and of a folder `HM-3-paint 2`. Null for a name that is not such a copy.
 */
export const conflictCopyOf = (name: string): string | null => {
  const match = /^(.+?) \d+(\.md)?$/.exec(name);
  return match === null ? null : `${match[1]}${match[2] ?? ""}`;
};

/** The number in a task id such as `HM-42`, or null when the id is not in the workspace's format. */
export const idNumber = (id: string, key: string): number | null => {
  const match = new RegExp(`^${key}-(\\d+)$`).exec(id);
  return match === null ? null : Number(match[1]);
};

export const taskFolderName = (id: string, title: string): string => {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "");
  return slug.length > 0 ? `${id}-${slug}` : id;
};

/** Whether task `id` is `root` or one of its subtasks at any depth, following `parent` links. */
export const inTaskSubtree = (
  tasks: ReadonlyArray<Pick<Task, "id" | "parent">>,
  id: string,
  root: string,
): boolean => {
  const parents = new Map(tasks.map((task) => [task.id, task.parent]));
  const seen = new Set<string>();
  for (let current: string | null = id; current !== null; current = parents.get(current) ?? null) {
    if (current === root) return true;
    if (seen.has(current)) return false;
    seen.add(current);
  }
  return false;
};

/** How many levels down a list sits: 1 for a top-level list, 0 for the workspace itself. */
export const listDepth = (list: string | null): number =>
  list === null ? 0 : list.split("/").length;

export const lastSegment = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

/** Whether `id` is the list `root` or one of its descendants. */
export const inSubtree = (id: string, root: string): boolean =>
  id === root || id.startsWith(`${root}/`);

/** The id a list gets under a new parent (null for the top level). */
export const movedListId = (id: string, parent: string | null): string =>
  parent === null ? lastSegment(id) : `${parent}/${lastSegment(id)}`;

/** How many levels a list and its descendants take up: 1 for a list without sublists. */
const subtreeHeight = (lists: ReadonlyArray<List>, id: string) =>
  Math.max(
    1,
    ...lists
      .filter((list) => inSubtree(list.id, id))
      .map((list) => listDepth(list.id) - listDepth(id) + 1),
  );

/**
 * Why list `id` may not move under `parent` (null for the top level), or null when it may.
 * The caller checks that both lists exist.
 */
export const listMoveError = (
  lists: ReadonlyArray<List>,
  id: string,
  parent: string | null,
): string | null => {
  if (parent !== null && inSubtree(parent, id)) return "A list cannot move inside itself";
  if (listDepth(parent) + subtreeHeight(lists, id) > MAX_LIST_DEPTH)
    return `Lists nest at most ${MAX_LIST_DEPTH} levels deep`;
  const current = lists.find((list) => list.id === id)?.parent ?? null;
  const moved = movedListId(id, parent);
  if (current !== parent && lists.some((list) => list.id === moved))
    return `There is already a list "${moved}"`;
  return null;
};
