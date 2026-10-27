import type { Diagnostic, StatusDefinition, Task } from "./domain.ts";
import { isClosedCategory, type LinkField } from "./layout.ts";
import type { TaskFile } from "./markdown.ts";

export interface ReadTask {
  readonly task: TaskFile;
  readonly malformedLinks: ReadonlyArray<LinkField>;
}

/** Every diagnostic about links, so each kind of problem is worded in one place. */
const linkProblem = {
  malformed: (field: LinkField) =>
    `${field} must be a list of task ids, such as [HM-3]; the ids found in it are used`,
  unknown: (field: LinkField, id: string) =>
    `${field} lists ${id}, which matches no task; the task counts as blocked until it is removed`,
  self: (field: LinkField) => `${field} lists the task itself, which is ignored`,
};

/** For each task id, the tasks whose `pick` lists it, in snapshot order. */
const reverseIndex = (
  tasks: ReadonlyArray<TaskFile>,
  pick: (task: TaskFile) => ReadonlyArray<string>,
) => {
  const index = new Map<string, Array<string>>();
  for (const task of tasks) {
    for (const id of pick(task)) {
      if (id === task.id) continue;
      const from = index.get(id);
      if (from === undefined) index.set(id, [task.id]);
      else from.push(task.id);
    }
  }
  return index;
};

/**
 * Completes the tasks of a snapshot with what other tasks say about them: `blocks`,
 * `mentionedIn` and `blocked`, which no file stores. Links that do not hold are diagnostics and
 * never stop a task from being read. A blocker that matches no task keeps its task blocked.
 */
export const linkTasks = (
  read: ReadonlyArray<ReadTask>,
  statuses: ReadonlyArray<StatusDefinition>,
): { readonly tasks: Array<Task>; readonly diagnostics: Array<Diagnostic> } => {
  const diagnostics: Array<Diagnostic> = [];
  const report = (task: TaskFile, message: string) =>
    diagnostics.push({ path: task.path, message });
  const known = new Set(read.map(({ task }) => task.id));

  const files = read.map(({ task, malformedLinks }): TaskFile => {
    for (const field of malformedLinks) report(task, linkProblem.malformed(field));
    if (task.blockedBy.includes(task.id)) report(task, linkProblem.self("blocked_by"));
    for (const id of task.blockedBy) {
      if (!known.has(id) && id !== task.id) report(task, linkProblem.unknown("blocked_by", id));
    }
    return { ...task, blockedBy: task.blockedBy.filter((id) => id !== task.id) };
  });

  const byId = new Map(files.map((task) => [task.id, task]));
  const category = new Map(statuses.map((status) => [status.id, status.category]));
  const isOpen = (id: string) => {
    const blocker = byId.get(id);
    return blocker === undefined || !isClosedCategory(category.get(blocker.status));
  };
  const blocks = reverseIndex(files, (task) => task.blockedBy);
  const mentionedIn = reverseIndex(files, (task) => task.mentions);

  return {
    tasks: files.map((task) => ({
      ...task,
      blocks: blocks.get(task.id) ?? [],
      blocked: task.blockedBy.some(isOpen),
      mentionedIn: mentionedIn.get(task.id) ?? [],
    })),
    diagnostics,
  };
};
