import type { Diagnostic, DiagnosticKind, Fix, FixAction } from "./domain.ts";
import { MAX_LIST_DEPTH } from "./layout.ts";

interface Problem {
  /** What to do about it, appended to the specific finding. */
  readonly remedy: string;
  /** The fixes this kind of problem can have; the scanner picks the one that applies, if any. */
  readonly fixes: ReadonlyArray<FixAction>;
}

/** Every kind of file problem: what a person can do about it and what octodo can fix. */
export const PROBLEMS = {
  "invalid-config": {
    remedy: "Fix config.json by hand",
    fixes: [],
  },
  "invalid-frontmatter": {
    remedy: "Fix the YAML between the --- lines by hand",
    fixes: [],
  },
  "missing-id": {
    remedy: "octodo gives it one on the next read once the file can be written",
    fixes: [],
  },
  "malformed-id": {
    remedy: "Fix it by hand, or delete the id line and octodo gives the task a new id",
    fixes: [],
  },
  "duplicate-id": {
    remedy: "Two tasks cannot share an id, so this copy and its subtasks are not read",
    fixes: ["fresh-id"],
  },
  "foreign-id": {
    remedy:
      "The task still loads. If it was copied from another workspace, delete the id line and octodo gives it a new id",
    fixes: [],
  },
  "unknown-status": {
    remedy: "It shows as an unstarted status until it is added to the workspace or the task moves",
    fixes: ["add-status"],
  },
  "unknown-priority": {
    remedy: "Until it is fixed the task has no priority",
    fixes: [],
  },
  "invalid-due": {
    remedy: "Until it is fixed the task has no due date",
    fixes: [],
  },
  "invalid-tags": {
    remedy: "Write tags as a list of words; until then the task has no tags",
    fixes: [],
  },
  "broken-link": {
    remedy: "Link only to tasks that exist; until then a missing blocker keeps the task blocked",
    fixes: ["drop-unknown-links"],
  },
  "self-link": {
    remedy: "A task cannot link to itself, so the link is ignored",
    fixes: ["drop-self-link"],
  },
  "malformed-link": {
    remedy: "Until it is a list of ids, the ids found in it are used",
    fixes: ["normalize-links"],
  },
  "loose-markdown": {
    remedy: "A task is a folder with task.md, so this file is not read",
    fixes: ["wrap-as-task", "remove-copy"],
  },
  "conflict-copy": {
    remedy: "A sync tool made it when two edits clashed, and it is not read",
    fixes: ["keep-copy", "remove-copy"],
  },
  "unmarked-folder": {
    remedy:
      "Add task.md or list.md to it, or move what it holds elsewhere; until then it is not read",
    fixes: [],
  },
  "both-markers": {
    remedy:
      "Delete task.md or list.md so the folder is one or the other; until then it is not read",
    fixes: [],
  },
  "list-in-task": {
    remedy: "A list cannot sit inside a task; move it out. Until then it is not read",
    fixes: [],
  },
  "list-too-deep": {
    remedy: `Lists nest at most ${MAX_LIST_DEPTH} levels deep; move it up. Until then it is not read`,
    fixes: [],
  },
  unreadable: {
    remedy: "Check that octodo may read it",
    fixes: [],
  },
  "old-layout": {
    remedy: "They are not read until `octo migrate` or the fix converts them",
    fixes: ["migrate"],
  },
} as const satisfies Record<DiagnosticKind, Problem>;

export const FIX_LABELS: Record<FixAction, string> = {
  "fresh-id": "Give this copy a new id",
  "wrap-as-task": "Make it a task",
  "keep-copy": "Keep it as a new task",
  "remove-copy": "Delete the copy",
  "drop-unknown-links": "Remove the unknown ids",
  "drop-self-link": "Remove the link to itself",
  "normalize-links": "Write it as a list of ids",
  migrate: "Convert the old layout",
  "add-status": "Add the status to config.json",
};

type FixesOf<K extends DiagnosticKind> = (typeof PROBLEMS)[K]["fixes"][number];

export interface DiagnosticOptions<K extends DiagnosticKind> {
  readonly field?: string | null;
  readonly fix?: FixesOf<K> | null;
}

/**
 * A diagnostic of `kind` at `path` (relative to the workspace root). `detail` says what is wrong
 * with this file; the kind's remedy follows it. The fix is the kind's only one unless `fix` picks
 * one, or null when none applies here.
 */
export const diagnostic = <K extends DiagnosticKind>(
  kind: K,
  path: string,
  detail: string,
  options: DiagnosticOptions<K> = {},
): Diagnostic => {
  const problem: Problem = PROBLEMS[kind];
  const action =
    options.fix === undefined
      ? problem.fixes.length === 1
        ? problem.fixes[0]!
        : null
      : options.fix;
  const fix: Fix | null = action === null ? null : { action, label: FIX_LABELS[action] };
  return {
    path,
    kind,
    field: options.field ?? null,
    message: `${detail}. ${problem.remedy}.`,
    fix,
  };
};
