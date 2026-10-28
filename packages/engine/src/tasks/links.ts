import type { Diagnostic, Entry, StatusDefinition, Task } from "@octodo/contract";
import { LINK_KINDS, readiness } from "@octodo/contract/rules";
import { diagnostic } from "../health/problems.ts";
import type { TaskFile } from "./task-file.ts";

/** For each id, the tasks or entries whose `pick` lists it, in snapshot order. */
const reverseIndex = <A extends { readonly id: string }>(
  tasks: ReadonlyArray<A>,
  pick: (task: A) => ReadonlyArray<string>,
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
 * Completes the tasks and entries of a snapshot with what others say about them: `blocks`,
 * `mentionedIn`, `blocked` and `ready`, which no file stores. A mention names a task or an entry
 * in any section; a link names only tasks. A link to an id no task file on disk has is a
 * diagnostic, never a reason not to read the task. A blocker that is not read, missing or only
 * unreadable for now, keeps the task blocked.
 */
export const linkTasks = (
  files: ReadonlyArray<TaskFile>,
  statuses: ReadonlyArray<StatusDefinition>,
  idsOnDisk: ReadonlySet<string>,
  entries: ReadonlyArray<Omit<Entry, "mentionedIn">> = [],
): {
  readonly tasks: Array<Task>;
  readonly entries: Array<Entry>;
  readonly diagnostics: Array<Diagnostic>;
} => {
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

  const rules = readiness(files, statuses);
  const blocks = reverseIndex(files, (task) => task.blockedBy);
  const mentionedIn = reverseIndex<{
    readonly id: string;
    readonly mentions: ReadonlyArray<string>;
  }>([...files, ...entries], (item) => item.mentions);

  return {
    tasks: files.map((task) => ({
      ...task,
      blocks: blocks.get(task.id) ?? [],
      ...rules.of(task),
      mentionedIn: mentionedIn.get(task.id) ?? [],
    })),
    entries: entries.map((entry) => ({ ...entry, mentionedIn: mentionedIn.get(entry.id) ?? [] })),
    diagnostics,
  };
};
