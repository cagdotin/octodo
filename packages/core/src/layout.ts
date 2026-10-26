/**
 * Plain functions with no Effect code, so the browser can import this module on its own
 * (`@octodo/core/layout`) without pulling the runtime in.
 *
 * The on-disk conventions of a workspace. Everything the app knows about a task's place comes
 * from folder names under `.octodo/`: `s<NN>-<id>` folders are statuses and `l<NN>-<slug>` folders
 * are lists. The number only orders a folder among its siblings; it is not part of the id, so
 * reordering renames folders without changing what anything refers to. A status folder belongs to
 * the nearest list above it, or to no list when it sits directly in `.octodo/`.
 */
import type { List, StatusCategory, StatusDefinition } from "./domain.ts";

export const TASKS_DIR = ".octodo";
export const CONFIG_FILE = "config.json";
export const STATUS_PREFIX = "s";
export const LIST_PREFIX = "l";
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

export type FolderKind =
  | {
      readonly type: "status" | "list";
      readonly slug: string;
      /** The number after the prefix, or null for a folder named by hand without one. */
      readonly position: number | null;
    }
  | { readonly type: "ignored" }
  | { readonly type: "unknown" };

const NUMBERED = /^([a-z])(\d*)-(.+)$/;

export const classifyFolder = (name: string): FolderKind => {
  if (name.startsWith(".")) return { type: "ignored" };
  const match = NUMBERED.exec(name);
  if (match === null) return { type: "unknown" };
  const [, prefix, digits, slug] = match;
  const position = digits === "" ? null : Number(digits);
  if (prefix === STATUS_PREFIX) return { type: "status", slug: slug!, position };
  if (prefix === LIST_PREFIX) return { type: "list", slug: slug!, position };
  return { type: "unknown" };
};

const numbered = (prefix: string, position: number, slug: string) =>
  `${prefix}${String(position).padStart(2, "0")}-${slug}`;

export const statusFolder = (position: number, id: string): string =>
  numbered(STATUS_PREFIX, position, id);

export const listFolder = (position: number, slug: string): string =>
  numbered(LIST_PREFIX, position, slug);

/** Sorts numbered folders by number, then the ones without a number, each by slug. */
export const compareFolders = (
  a: { readonly slug: string; readonly position: number | null },
  b: { readonly slug: string; readonly position: number | null },
): number => {
  if (a.position !== b.position) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  }
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
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

/** The number in a task id such as `HM-42`, or null when the id is not in the workspace's format. */
export const idNumber = (id: string, key: string): number | null => {
  const match = new RegExp(`^${key}-(\\d+)$`).exec(id);
  return match === null ? null : Number(match[1]);
};

export const taskFileName = (id: string, title: string): string => {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "");
  return slug.length > 0 ? `${id}-${slug}.md` : `${id}.md`;
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
