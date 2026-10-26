import type {
  List,
  MoveListInput,
  MoveTaskInput,
  Priority,
  StatusCategory,
  StatusDefinition,
  Task,
  WorkspaceSnapshot,
} from "@octodo/core";
import { inSubtree, isClosedCategory, movedListId } from "@octodo/core/layout";
import {
  addDays,
  format,
  isBefore,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfDay,
} from "date-fns";

export const PRIORITIES: ReadonlyArray<{ value: Priority; label: string }> = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

/** Text colour class for a priority flag; the colours are theme tokens defined in index.css. */
export const PRIORITY_TEXT: Record<Priority, string> = {
  urgent: "text-priority-urgent",
  high: "text-priority-high",
  medium: "text-priority-medium",
  low: "text-priority-low",
  none: "text-muted-foreground",
};

/**
 * The list view's group order, Linear's: the work closest to done first. Started, unstarted and
 * backlog come before the closed categories, and within a category the later status leads (In
 * Review above In Progress). Snapshots, the board and settings use the workflow order instead.
 */
const LIST_VIEW_CATEGORIES: ReadonlyArray<StatusCategory> = [
  "started",
  "unstarted",
  "backlog",
  "completed",
  "canceled",
  "archived",
];

export const listViewOrder = (statuses: ReadonlyArray<StatusDefinition>) =>
  LIST_VIEW_CATEGORIES.flatMap((category) =>
    statuses.filter((status) => status.category === category).reverse(),
  );

export const statusMap = (statuses: ReadonlyArray<StatusDefinition>) =>
  new Map(statuses.map((status) => [status.id, status]));

export const firstStatus = (statuses: ReadonlyArray<StatusDefinition>, category: StatusCategory) =>
  statuses.find((status) => status.category === category);

// Smart views share the `list` search param with real lists; real list ids never start with "@".
export const SMART = {
  all: undefined,
  today: "@today",
  upcoming: "@upcoming",
  none: "@none",
} as const;

export const isSmartView = (list: string | undefined) => list === undefined || list.startsWith("@");

export const isInList = (task: Task, list: string) =>
  task.list !== null && inSubtree(task.list, list);

/** The filter tabs above the list: Active (unstarted + started), Backlog, and All but archived. */
export interface DisplayOptions {
  showBacklog: boolean;
  showCompleted: boolean;
  showArchived: boolean;
}

/** Which status categories the display options let through. */
export const visibleCategory = (
  category: StatusCategory | undefined,
  display: DisplayOptions,
): boolean => {
  switch (category) {
    case "backlog":
      return display.showBacklog;
    case "completed":
    case "canceled":
      return display.showCompleted;
    case "archived":
      return display.showArchived;
    default:
      return true;
  }
};

export interface TaskFilter {
  priorities: ReadonlyArray<Priority>;
  tags: ReadonlyArray<string>;
  lists: ReadonlyArray<string>;
}

export const EMPTY_FILTER: TaskFilter = { priorities: [], tags: [], lists: [] };

export const filterCount = (filter: TaskFilter) =>
  filter.priorities.length + filter.tags.length + filter.lists.length;

/** Within each facet any selected value matches; facets combine with AND. */
export const matchesFilter = (task: Task, filter: TaskFilter) =>
  (filter.priorities.length === 0 || filter.priorities.includes(task.priority)) &&
  (filter.tags.length === 0 || filter.tags.some((tag) => task.tags.includes(tag))) &&
  (filter.lists.length === 0 || filter.lists.some((list) => isInList(task, list)));

export const allTags = (tasks: ReadonlyArray<Task>) =>
  [...new Set(tasks.flatMap((task) => task.tags))].sort((a, b) => a.localeCompare(b));

export const todayKey = () => format(new Date(), "yyyy-MM-dd");

export const filterTasks = (
  tasks: ReadonlyArray<Task>,
  list: string | undefined,
): ReadonlyArray<Task> => {
  if (list === undefined) return tasks;
  const today = todayKey();
  switch (list) {
    case SMART.today:
      return tasks.filter((task) => task.due !== null && task.due <= today);
    case SMART.upcoming:
      return tasks.filter(
        (task) => task.due !== null && task.due <= format(addDays(new Date(), 7), "yyyy-MM-dd"),
      );
    case SMART.none:
      return tasks.filter((task) => task.list === null);
    default:
      return tasks.filter((task) => isInList(task, list));
  }
};

export const viewTitle = (list: string | undefined, lists: ReadonlyArray<List>) => {
  switch (list) {
    case undefined:
      return "All tasks";
    case SMART.today:
      return "Today";
    case SMART.upcoming:
      return "Next 7 days";
    case SMART.none:
      return "No list";
    default:
      return lists.find((entry) => entry.id === list)?.name ?? list;
  }
};

export interface DueInfo {
  label: string;
  overdue: boolean;
  today: boolean;
}

export const dueInfo = (due: string | null): DueInfo | null => {
  if (due === null) return null;
  const date = parseISO(due);
  if (Number.isNaN(date.getTime())) return { label: due, overdue: false, today: false };
  const today = isToday(date);
  const overdue = !today && isBefore(date, startOfDay(new Date()));
  let label = format(
    date,
    date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy",
  );
  if (today) label = "Today";
  else if (isTomorrow(date)) label = "Tomorrow";
  else if (isYesterday(date)) label = "Yesterday";
  return { label, overdue, today };
};

/** Short "Oct 19" label for a creation timestamp, with the full date as a tooltip. */
export const createdLabel = (created: string | null) => {
  if (created === null) return null;
  const date = parseISO(created);
  if (Number.isNaN(date.getTime())) return null;
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return {
    label: format(date, thisYear ? "MMM d" : "MMM yyyy"),
    title: `Created ${format(date, "MMM d, yyyy")}`,
  };
};

export const formatTimestamp = (value: string | null) => {
  if (value === null) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, "MMM d, yyyy HH:mm");
};

/** Open (not closed) task counts per list, including tasks in nested lists. */
export const listCounts = (snapshot: WorkspaceSnapshot) => {
  const statuses = statusMap(snapshot.statuses);
  const counts = new Map<string, number>();
  let none = 0;
  let open = 0;
  for (const task of snapshot.tasks) {
    if (isClosedCategory(statuses.get(task.status)?.category)) continue;
    open++;
    if (task.list === null) {
      none++;
      continue;
    }
    const parts = task.list.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const id = parts.slice(0, i).join("/");
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return { counts, none, open };
};

/**
 * Mirrors a list move in a cached snapshot. Lists stay depth first, so the moved list and its
 * descendants travel as one block; a new parent renames the block's ids and its tasks' lists.
 */
export const applyListMove = (
  snapshot: WorkspaceSnapshot,
  id: string,
  move: MoveListInput,
): WorkspaceSnapshot => {
  const list = snapshot.lists.find((entry) => entry.id === id);
  if (!list) return snapshot;
  const parent = move.parent === undefined ? list.parent : move.parent;
  const target = movedListId(id, parent);
  const rename = (value: string) =>
    inSubtree(value, id) ? target + value.slice(id.length) : value;
  const block = snapshot.lists
    .filter((entry) => inSubtree(entry.id, id))
    .map((entry) => ({
      ...entry,
      id: rename(entry.id),
      parent: entry.id === id ? parent : entry.parent === null ? null : rename(entry.parent),
    }));
  const rest = snapshot.lists.filter((entry) => !inSubtree(entry.id, id));
  // Where the block goes: before a sibling, after a sibling's whole subtree, or at the end of the
  // parent's subtree (the end of everything for the top level).
  const endOf = (root: string) => rest.findLastIndex((entry) => inSubtree(entry.id, root)) + 1;
  let index = parent === null ? rest.length : endOf(parent);
  if (move.before !== undefined && rest.some((entry) => entry.id === move.before)) {
    index = rest.findIndex((entry) => entry.id === move.before);
  } else if (move.after !== undefined && rest.some((entry) => entry.id === move.after)) {
    index = endOf(move.after);
  }
  return {
    ...snapshot,
    lists: [...rest.slice(0, index), ...block, ...rest.slice(index)],
    tasks: snapshot.tasks.map((task) =>
      task.list !== null && inSubtree(task.list, id) ? { ...task, list: rename(task.list) } : task,
    ),
  };
};

export interface ListNode {
  list: List;
  children: Array<ListNode>;
}

/** Lists as a tree, in the order the snapshot gives them (folder order). */
export const listTree = (lists: ReadonlyArray<List>): Array<ListNode> => {
  const nodes = new Map<string, ListNode>(lists.map((list) => [list.id, { list, children: [] }]));
  const roots: Array<ListNode> = [];
  for (const node of nodes.values()) {
    const parent = node.list.parent === null ? undefined : nodes.get(node.list.parent);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
};

/** Label of a list including its parents, e.g. "Garden / Seeds". */
export const listLabel = (lists: ReadonlyArray<List>, id: string | null) => {
  if (id === null) return "No list";
  const byId = new Map(lists.map((list) => [list.id, list]));
  const names: Array<string> = [];
  for (
    let current = byId.get(id);
    current;
    current = current.parent ? byId.get(current.parent) : undefined
  ) {
    names.unshift(current.name);
  }
  return names.length > 0 ? names.join(" / ") : id;
};

/**
 * Mirrors a move in a cached snapshot: the task changes status/list and is placed next to its
 * neighbour in the task array, which is the order views render in.
 */
export const applyMove = (
  snapshot: WorkspaceSnapshot,
  id: string,
  move: MoveTaskInput,
): WorkspaceSnapshot => {
  const task = snapshot.tasks.find((entry) => entry.id === id);
  if (!task) return snapshot;
  const moved: Task = {
    ...task,
    status: move.status ?? task.status,
    list: move.list === undefined ? task.list : move.list,
  };
  const rest = snapshot.tasks.filter((entry) => entry.id !== id);
  let index = rest.length;
  if (move.before !== undefined) {
    const at = rest.findIndex((entry) => entry.id === move.before);
    if (at !== -1) index = at;
  } else if (move.after !== undefined) {
    const at = rest.findIndex((entry) => entry.id === move.after);
    if (at !== -1) index = at + 1;
  }
  return { ...snapshot, tasks: [...rest.slice(0, index), moved, ...rest.slice(index)] };
};

/**
 * Picks `before`/`after` for dropping `task` at `index` of a rendered column. Order keys only
 * mean something within one folder (status + list), so neighbours from other lists are skipped.
 */
export const neighbours = (
  column: ReadonlyArray<Task>,
  index: number,
  list: string | null,
): Pick<MoveTaskInput, "before" | "after"> => {
  const next = column.slice(index).find((entry) => entry.list === list);
  if (next) return { before: next.id };
  const previous = column
    .slice(0, index)
    .reverse()
    .find((entry) => entry.list === list);
  if (previous) return { after: previous.id };
  return {};
};

export interface QuickAdd {
  title: string;
  priority?: Priority;
  tags: Array<string>;
  due?: string;
}

const PRIORITY_WORDS: Record<string, Priority> = {
  urgent: "urgent",
  high: "high",
  medium: "medium",
  med: "medium",
  low: "low",
  none: "none",
  "1": "urgent",
  "2": "high",
  "3": "medium",
  "4": "low",
};

const relativeDue = (value: string): string | undefined => {
  const lower = value.toLowerCase();
  if (lower === "today") return todayKey();
  if (lower === "tomorrow" || lower === "tmr") return format(addDays(new Date(), 1), "yyyy-MM-dd");
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime())) return value;
  return undefined;
};

/**
 * Parses quick-add text: `!high` / `!1`-`!4` priority, `#tag`, and `due:YYYY-MM-DD`
 * (or `due:today`/`due:tomorrow`). Everything else is the title.
 */
export const parseQuickAdd = (text: string): QuickAdd => {
  const result: QuickAdd = { title: "", tags: [] };
  const words: Array<string> = [];
  for (const word of text.split(/\s+/)) {
    if (word === "") continue;
    const priority = /^!(\w+)$/.exec(word)?.[1];
    if (priority !== undefined && PRIORITY_WORDS[priority.toLowerCase()] !== undefined) {
      result.priority = PRIORITY_WORDS[priority.toLowerCase()]!;
      continue;
    }
    const tag = /^#([\w/-]+)$/.exec(word)?.[1];
    if (tag !== undefined) {
      if (!result.tags.includes(tag)) result.tags.push(tag);
      continue;
    }
    const due = /^due:(\S+)$/i.exec(word)?.[1];
    const parsed = due === undefined ? undefined : relativeDue(due);
    if (parsed !== undefined) {
      result.due = parsed;
      continue;
    }
    words.push(word);
  }
  result.title = words.join(" ");
  return result;
};
