import type {
  List,
  MoveListInput,
  MoveTaskInput,
  Priority,
  StatusCategory,
  StatusDefinition,
  Task,
  WorkspaceSnapshot,
} from "@octodo/contract";
import {
  defaultStatus,
  destination,
  inSubtree,
  isClosedCategory,
  isDueBy,
  movedListId,
  readiness,
  taskSubtree,
  type DayContext,
} from "@octodo/contract/rules";
import { addDays, format, parseISO } from "date-fns";

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
  ready: "@ready",
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

/**
 * The tasks a view shows. Views of a list show top-level tasks, with subtasks inside their parent;
 * the date views show every task due on or before their last day, a task of a kind by its kind's
 * day (`kindDay`), and Ready every task open and not blocked, subtasks too.
 */
export const filterTasks = (
  { tasks: all }: Pick<WorkspaceSnapshot, "tasks">,
  list: string | undefined,
  kindDay: DayContext["pluginDay"],
  today: string,
): ReadonlyArray<Task> => {
  const context = { today, pluginDay: kindDay };
  const dueBy = (last: string) => all.filter((task) => isDueBy(task, last, context));
  const tasks = all.filter((task) => task.parent === null);
  switch (list) {
    case undefined:
      return tasks;
    case SMART.today:
      return dueBy(context.today);
    case SMART.upcoming:
      return dueBy(format(addDays(parseISO(today), 7), "yyyy-MM-dd"));
    case SMART.ready:
      return all.filter((task) => task.ready);
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
    case SMART.ready:
      return "Ready";
    case SMART.none:
      return "No list";
    default:
      return lists.find((entry) => entry.id === list)?.name ?? list;
  }
};

/** Short "Oct 19" label for a creation timestamp, with the full date as a tooltip. */
export const createdLabel = (created: string | null, today: string) => {
  if (created === null) return null;
  const date = parseISO(created);
  if (Number.isNaN(date.getTime())) return null;
  const thisYear = format(date, "yyyy") === today.slice(0, 4);
  return {
    label: format(date, thisYear ? "MMM d" : "MMM yyyy"),
    title: `Created ${format(date, "MMM d, yyyy")}`,
  };
};

/** Open (not closed) top-level task counts per list, including tasks in nested lists. */
export const listCounts = (snapshot: WorkspaceSnapshot) => {
  const statuses = statusMap(snapshot.statuses);
  const counts = new Map<string, number>();
  let none = 0;
  let open = 0;
  for (const task of snapshot.tasks) {
    if (task.parent !== null || isClosedCategory(statuses.get(task.status)?.category)) continue;
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
 * Mirrors a move in a cached snapshot, whose task array is the order views render in. As in core,
 * the task keeps its place unless the move names a neighbour or changes its list or parent; then it
 * goes next to the neighbour, or last. A task that `completesInPlace` (a recurring task) moved into
 * a completed status goes to the first unstarted status instead, as the engine moves it.
 */
export const applyMove = (
  snapshot: WorkspaceSnapshot,
  id: string,
  move: MoveTaskInput,
  completesInPlace: (task: Task) => boolean = () => false,
): WorkspaceSnapshot => {
  const task = snapshot.tasks.find((entry) => entry.id === id);
  if (!task) return snapshot;
  const container = destination(snapshot, move, task);
  if (typeof container === "string") return snapshot;
  const { list, parent } = container;
  const completing =
    snapshot.statuses.find((status) => status.id === move.status)?.category === "completed" &&
    completesInPlace(task);
  const status = completing ? (defaultStatus(snapshot.statuses)?.id ?? task.status) : move.status;
  const moved: Task = { ...task, status: status ?? task.status, list, parent };
  const placed = move.before !== undefined || move.after !== undefined;
  if (!placed && list === task.list && parent === task.parent)
    return withReadiness({
      ...snapshot,
      tasks: snapshot.tasks.map((entry) => (entry === task ? moved : entry)),
    });
  const rest = snapshot.tasks.filter((entry) => entry.id !== id);
  let index = rest.length;
  if (move.before !== undefined) {
    const at = rest.findIndex((entry) => entry.id === move.before);
    if (at !== -1) index = at;
  } else if (move.after !== undefined) {
    const at = rest.findIndex((entry) => entry.id === move.after);
    if (at !== -1) index = at + 1;
  }
  return withReadiness({
    ...snapshot,
    tasks: [...rest.slice(0, index), moved, ...rest.slice(index)],
  });
};

/**
 * Picks `before`/`after` for dropping `task` at `index` of a rendered column. Order keys only
 * mean something among one container's tasks in one status, so neighbours from other lists are
 * skipped.
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

/** The tasks directly under `parent`, in the snapshot's order. */
export const subtasksOf = (tasks: ReadonlyArray<Task>, parent: string) =>
  tasks.filter((task) => task.parent === parent);

/** How many tasks go with `id` when it is deleted: its subtasks at any depth. */
export const descendantCount = (tasks: ReadonlyArray<Task>, id: string) =>
  taskSubtree(tasks, id).size - 1;

/** Removes a task and its subtasks at any depth, as deleting its folder does. */
export const withoutSubtree = (tasks: ReadonlyArray<Task>, id: string) => {
  const ids = taskSubtree(tasks, id);
  return tasks.filter((task) => !ids.has(task.id));
};

/** The snapshot with each task's `blocked` and `ready` as the next read derives them. */
const withReadiness = (snapshot: WorkspaceSnapshot): WorkspaceSnapshot => {
  const rules = readiness(snapshot.tasks, snapshot.statuses);
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      const { blocked, ready } = rules.of(task);
      return blocked === task.blocked && ready === task.ready ? task : { ...task, blocked, ready };
    }),
  };
};

/** The snapshot once task `id` waits for `blockedBy`, with what the next read derives from it. */
export const withBlockedBy = (
  snapshot: WorkspaceSnapshot,
  id: string,
  blockedBy: ReadonlyArray<string>,
): WorkspaceSnapshot => {
  const position = new Map(snapshot.tasks.map((task, index) => [task.id, index]));
  const waits = new Set(blockedBy);
  const blocks = (task: Task) => {
    const others = task.blocks.filter((other) => other !== id);
    if (!waits.has(task.id)) return others;
    return [...others, id].toSorted((a, b) => position.get(a)! - position.get(b)!);
  };
  return withReadiness({
    ...snapshot,
    tasks: snapshot.tasks.map((task) =>
      task.id === id ? { ...task, blockedBy } : { ...task, blocks: blocks(task) },
    ),
  });
};

export interface Progress {
  readonly done: number;
  readonly total: number;
}

/** Direct subtasks per parent id, counting those in a completed status as done; canceled ones don't count. */
export const subtaskProgress = (snapshot: WorkspaceSnapshot): ReadonlyMap<string, Progress> => {
  const statuses = statusMap(snapshot.statuses);
  const progress = new Map<string, Progress>();
  for (const task of snapshot.tasks) {
    const category = statuses.get(task.status)?.category;
    if (task.parent === null || category === "canceled") continue;
    const { done, total } = progress.get(task.parent) ?? { done: 0, total: 0 };
    const completed = category === "completed";
    progress.set(task.parent, { done: done + (completed ? 1 : 0), total: total + 1 });
  }
  return progress;
};
