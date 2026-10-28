/**
 * Rules the browser runs for every keystroke, drag hover and optimistic update, and the engine runs
 * the same way: plain functions with no Effect code, so `@octodo/contract/rules` pulls no runtime
 * into the web app.
 */
import type {
  Diagnostic,
  Entry,
  EntryDay,
  List,
  StatusCategory,
  StatusDefinition,
  Task,
} from "./domain.ts";

/** How deep lists nest: a top-level list, its sublists and theirs. */
export const MAX_LIST_DEPTH = 3;

/** The largest attachment octodo saves or reads: 20 MB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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
/** A task id as a pattern source: a workspace key, a dash and a number, as in `HM-42`. */
export const TASK_ID = `${KEY}-\\d+`;

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

/** Where a task sits: in a list (or `.octodo/tasks/` for null), or under a parent task in that list. */
export interface Container {
  readonly list: string | null;
  readonly parent: string | null;
}

/**
 * The container a create or move puts a task in, or why it cannot go there. `parent` wins the
 * list from its task; `list` alone takes the task to the top of that list; neither keeps `from`.
 */
export const destination = (
  { tasks, lists }: { readonly tasks: ReadonlyArray<Task>; readonly lists: ReadonlyArray<List> },
  input: { readonly list?: string | null; readonly parent?: string | null },
  from: Container,
): Container | string => {
  if (input.parent !== undefined && input.parent !== null) {
    if (input.list !== undefined) return "Give a list or a parent task, not both";
    const parent = tasks.find((task) => task.id === input.parent);
    return parent === undefined
      ? `Unknown parent task "${input.parent}"`
      : { list: parent.list, parent: parent.id };
  }
  const list = input.list === undefined ? from.list : input.list;
  if (list !== null && !lists.some((known) => known.id === list)) return `Unknown list "${list}"`;
  const keepParent = input.list === undefined && input.parent === undefined;
  return { list, parent: keepParent ? from.parent : null };
};

/** How many levels down a list sits: 1 for a top-level list, 0 for the workspace itself. */
export const listDepth = (list: string | null): number =>
  list === null ? 0 : list.split("/").length;

const lastSegment = (id: string): string => id.slice(id.lastIndexOf("/") + 1);

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

/** What a snapshot derives for a task from the others and stores in no file. */
export interface Readiness {
  /** Whether a task in `blockedBy` holds it back. */
  readonly blocked: boolean;
  /** Whether it can start now: open, and not blocked. */
  readonly ready: boolean;
}

/**
 * The blocked and ready rules over one snapshot's tasks. A blocker holds a task back while its
 * status is in no closed category or no task read has its id.
 */
export const readiness = (
  tasks: ReadonlyArray<Pick<Task, "id" | "status">>,
  statuses: ReadonlyArray<StatusDefinition>,
) => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const category = new Map(statuses.map((status) => [status.id, status.category]));
  const isOpen = (status: string) => !isClosedCategory(category.get(status));
  const holdsBack = (id: string) => {
    const blocker = byId.get(id);
    return blocker === undefined || isOpen(blocker.status);
  };
  return {
    /** The ids in `blockedBy` that hold a task back. */
    openBlockers: (blockedBy: ReadonlyArray<string>): Array<string> => blockedBy.filter(holdsBack),
    of: (task: Pick<Task, "status" | "blockedBy">): Readiness => {
      const blocked = task.blockedBy.some(holdsBack);
      return { blocked, ready: !blocked && isOpen(task.status) };
    },
  };
};

/** Whether a diagnostic is something to fix: everything but a note, a markdown file read as text. */
export const isProblem = (diagnostic: Pick<Diagnostic, "kind">): boolean =>
  diagnostic.kind !== "note";

/**
 * The day a plugin gives a task of its kind or an entry of its section, from its fields and today
 * (decisions 0025, 0027): a recurring task's next day, a yearly counter's next occurrence.
 */
export type PluginDay = (fields: never, today: string) => string | null;

/** Today where this runs, `YYYY-MM-DD`: the person's computer (decision 0010). */
export const localDay = (now = new Date()): string =>
  [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");

/** What a task's or an entry's day depends on besides itself: today, and each plugin's `day`. */
export interface DayContext {
  readonly today: string;
  /** The `day` of the plugin with this id; undefined for a plugin that gives none. */
  readonly pluginDay: (plugin: string) => PluginDay | undefined;
}

/**
 * The day a task is due on: a plain task's `due` day; for a task of a kind, the day its plugin
 * gives (a recurring task's next), never its `due` (0025).
 */
export const taskDay = (task: Pick<Task, "due" | "kind">, context: DayContext): string | null =>
  task.kind === undefined
    ? (task.due?.slice(0, 10) ?? null)
    : (context.pluginDay(task.kind.id)?.(task.kind.fields as never, context.today) ?? null);

/** Whether a task is due on or before `last`, overdue included, as Today and Next 7 days list it. */
export const isDueBy = (
  task: Pick<Task, "due" | "kind">,
  last: string,
  context: DayContext,
): boolean => {
  const day = taskDay(task, context);
  return day !== null && day <= last;
};

/**
 * The entries whose section's plugin gives them a day on or before `last`, by day, then as given:
 * the rows Today and Next 7 days show beside the tasks (decision 0027).
 */
export const entriesDueBy = (
  entries: ReadonlyArray<Pick<Entry, "id" | "section" | "title" | "fields">>,
  last: string,
  context: DayContext,
): Array<EntryDay> =>
  entries
    .flatMap(({ id, section, title, fields }) => {
      const day = context.pluginDay(section)?.(fields as never, context.today) ?? null;
      return day === null || day > last ? [] : [{ id, section, title, day }];
    })
    .toSorted((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
