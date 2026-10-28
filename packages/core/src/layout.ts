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

/** A workspace key: letters and digits, starting with a letter, as `HM` in `HM-42`. */
export const WORKSPACE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const KEY = WORKSPACE_KEY.source.slice(1, -1);
const TASK_ID = `${KEY}-\\d+`;

export const isWorkspaceKey = (key: string): boolean => WORKSPACE_KEY.test(key);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Task ids with a usual key, or with workspace key `key` when it is not a usual one. */
const taskIdSource = (key?: string) =>
  key === undefined || isWorkspaceKey(key) ? TASK_ID : `(?:${escapeRegExp(key)}|${KEY})-\\d+`;

/**
 * Whether `id` has the shape of a task id: a key, a dash and a number, as in `HM-42`. A workspace
 * whose `key` has another shape still accepts the ids made with it.
 */
export const isTaskId = (id: string, key?: string): boolean =>
  new RegExp(`^${taskIdSource(key)}$`).test(id);

/**
 * The task ids written in `text`, and whether they are all it says: `HM-2, HM-3` is two ids,
 * `HM-2 after lunch` one id and some words.
 */
export const taskIdsIn = (
  text: string,
  key?: string,
): { readonly ids: Array<string>; readonly only: boolean } => {
  const pattern = new RegExp(taskIdSource(key), "g");
  return {
    ids: text.match(pattern) ?? [],
    only: text.replace(pattern, "").replace(/[\s,;]+/g, "") === "",
  };
};

/** The number in a task id such as `HM-42`, or null when the id is not in the workspace's format. */
export const idNumber = (id: string, key: string): number | null => {
  const match = new RegExp(`^${escapeRegExp(key)}-(\\d+)$`).exec(id);
  return match === null ? null : Number(match[1]);
};

export const taskFolderName = (id: string, title: string): string => {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "");
  return slug.length > 0 ? `${id}-${slug}` : id;
};

/** Task `root` and its subtasks at any depth. */
export const taskSubtree = (
  tasks: ReadonlyArray<Pick<Task, "id" | "parent">>,
  root: string,
): ReadonlySet<string> => {
  const children = new Map<string, Array<string>>();
  for (const task of tasks) {
    if (task.parent === null) continue;
    const siblings = children.get(task.parent);
    if (siblings === undefined) children.set(task.parent, [task.id]);
    else siblings.push(task.id);
  }
  const subtree = new Set([root]);
  for (const id of subtree) for (const child of children.get(id) ?? []) subtree.add(child);
  return subtree;
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

/**
 * Relations a task stores in its frontmatter as a list of task ids: `blocked_by: [HM-3, HM-7]`.
 * Only the task named by `field` stores an edge; the other end gets it as `reverse` when a
 * snapshot is read. The code is not generic over kinds: a new one also needs its `Task` fields,
 * its input in `UpdateTaskInput`, and its handling in the MCP tools, the CLI and the web app.
 */
export const LINK_KINDS = [
  {
    field: "blocked_by",
    forward: "blockedBy",
    reverse: "blocks",
    label: "Blocked by",
    reverseLabel: "Blocks",
  },
] as const;

export type LinkKind = (typeof LINK_KINDS)[number];
export type LinkField = LinkKind["field"];

export const isLinkField = (key: string): key is LinkField =>
  LINK_KINDS.some((kind) => kind.field === key);

/** Where a body mentions a task as `[[HM-3]]`: the id and the offsets of the whole `[[...]]`. */
export interface Mention {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

const MENTION = new RegExp(`\\[\\[(${TASK_ID})\\]\\]`, "g");
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})(.*)$/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

/** Columns of leading whitespace, a tab reaching the next multiple of four. */
const indentOf = (line: string) => {
  let columns = 0;
  for (const char of line) {
    if (char === " ") columns++;
    else if (char === "\t") columns += 4 - (columns % 4);
    else break;
  }
  return columns;
};

/** Whether the character before `index` is escaped, by an odd run of backslashes. */
const escapedAt = (text: string, index: number) => {
  let backslashes = 0;
  while (text[index - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1;
};

/**
 * Offset ranges of fenced and indented code blocks, code spans and HTML comments, which hold text
 * rather than mentions, sorted by start.
 */
const codeRanges = (body: string): Array<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = [];
  let fence: { readonly marker: string; readonly from: number } | null = null;
  let indented: { readonly from: number; to: number } | null = null;
  /** Whether the last block began as or inside a list item, where indented lines are no code. */
  let inList = false;
  let paragraph: Array<readonly [number, number]> = [];
  const closeParagraph = () => {
    ranges.push(...spansIn(body, paragraph));
    paragraph = [];
  };
  let offset = 0;
  for (const line of body.split("\n")) {
    const start = offset;
    offset += line.length + 1;
    const blank = line.trim() === "";
    const fenceLine = FENCE.exec(line);
    if (fence !== null) {
      const marker = fenceLine?.[1];
      if (
        marker !== undefined &&
        marker[0] === fence.marker[0] &&
        marker.length >= fence.marker.length &&
        fenceLine![2]!.trim() === ""
      ) {
        ranges.push([fence.from, start + line.length]);
        fence = null;
      }
      continue;
    }
    if (indented !== null) {
      if (blank || indentOf(line) >= 4) {
        if (!blank) indented.to = start + line.length;
        continue;
      }
      ranges.push([indented.from, indented.to]);
      indented = null;
    }
    if (fenceLine !== null) {
      closeParagraph();
      fence = { marker: fenceLine[1]!, from: start };
    } else if (blank) closeParagraph();
    else if (paragraph.length > 0) paragraph.push([start, start + line.length]);
    else if (indentOf(line) >= 4 && !inList) indented = { from: start, to: start + line.length };
    else {
      inList = LIST_ITEM.test(line) || (inList && indentOf(line) >= 2);
      paragraph.push([start, start + line.length]);
    }
  }
  if (fence !== null) ranges.push([fence.from, body.length]);
  if (indented !== null) ranges.push([indented.from, indented.to]);
  closeParagraph();
  const inCode = (index: number) => ranges.some(([from, to]) => index >= from && index < to);
  const comments = [...body.matchAll(COMMENT)].filter((match) => !inCode(match.index));
  for (const match of comments) ranges.push([match.index, match.index + match[0].length]);
  return ranges.toSorted((a, b) => a[0] - b[0]);
};

/**
 * Code spans in a paragraph: a run of backticks up to the next run of the same length. A
 * backslash before a run escapes its first backtick, outside a span only.
 */
const spansIn = (body: string, lines: ReadonlyArray<readonly [number, number]>) => {
  if (lines.length === 0) return [];
  const from = lines[0]![0];
  const text = body.slice(from, lines.at(-1)![1]);
  const runs = [...text.matchAll(/`+/g)].map((run) => ({ at: run.index, length: run[0].length }));
  /** The indices of the runs of each length, ascending. */
  const byLength = new Map<number, Array<number>>();
  for (const [index, run] of runs.entries()) {
    const same = byLength.get(run.length);
    if (same === undefined) byLength.set(run.length, [index]);
    else same.push(index);
  }
  const nextOfLength = (length: number, after: number) => {
    const same = byLength.get(length) ?? [];
    let [low, high] = [0, same.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (same[middle]! <= after) low = middle + 1;
      else high = middle;
    }
    return same[low];
  };
  const spans: Array<readonly [number, number]> = [];
  for (let i = 0; i < runs.length; i++) {
    const escaped = escapedAt(text, runs[i]!.at) ? 1 : 0;
    const open = { at: runs[i]!.at + escaped, length: runs[i]!.length - escaped };
    const close = open.length === 0 ? undefined : nextOfLength(open.length, i);
    if (close === undefined) continue;
    spans.push([from + open.at, from + runs[close]!.at + runs[close]!.length]);
    i = close;
  }
  return spans;
};

/** The `[[HM-3]]` mentions in a markdown body, in order, skipping escaped ones and code. */
export const findMentions = (body: string): Array<Mention> => {
  if (!body.includes("[[")) return [];
  const code = codeRanges(body);
  const mentions: Array<Mention> = [];
  let range = 0;
  for (const match of body.matchAll(MENTION)) {
    while (range < code.length && code[range]![1] <= match.index) range++;
    const inCode = range < code.length && code[range]![0] <= match.index;
    if (!inCode && !escapedAt(body, match.index))
      mentions.push({ id: match[1]!, from: match.index, to: match.index + match[0].length });
  }
  return mentions;
};

/** Work that can start now: not blocked, and not in a closed category. */
export const isReady = (
  task: Pick<Task, "status" | "blocked">,
  statuses: ReadonlyArray<StatusDefinition>,
): boolean =>
  !task.blocked &&
  !isClosedCategory(statuses.find((status) => status.id === task.status)?.category);
