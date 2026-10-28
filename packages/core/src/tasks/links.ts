import type { Diagnostic, StatusDefinition, Task } from "../domain.ts";
import { diagnostic } from "../health/problems.ts";
import { LINK_KINDS, isClosedCategory } from "../layout.ts";
import type { TaskFile } from "./task-file.ts";

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
 * `mentionedIn` and `blocked`, which no file stores. A link to an id no file on disk has is a
 * diagnostic, never a reason not to read the task. A blocker that is not read, missing or only
 * unreadable for now, keeps the task blocked.
 */
export const linkTasks = (
  files: ReadonlyArray<TaskFile>,
  statuses: ReadonlyArray<StatusDefinition>,
  idsOnDisk: ReadonlySet<string>,
): { readonly tasks: Array<Task>; readonly diagnostics: Array<Diagnostic> } => {
  const diagnostics = files.flatMap((task) =>
    LINK_KINDS.flatMap((kind) => {
      const unknown = task[kind.forward].filter((id) => !idsOnDisk.has(id));
      if (unknown.length === 0) return [];
      const which = unknown.length === 1 ? "which matches" : "which match";
      return [
        diagnostic(
          "broken-link",
          task.path,
          `${kind.field} lists ${unknown.join(", ")}, ${which} no task`,
          { field: kind.field },
        ),
      ];
    }),
  );

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
