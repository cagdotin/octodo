import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { defaultStatus } from "@octodo/core/layout";
import { Link } from "@tanstack/react-router";
import { CornerLeftUpIcon, ListTreeIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCreateTask, useMoveTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  descendantCount,
  firstStatus,
  subtaskProgress,
  subtasksOf,
  type Progress,
} from "@/lib/tasks";

/** "2/5" with a tree glyph for a task with subtasks, nothing otherwise. */
export function SubtaskCount({
  progress,
  className,
}: {
  progress: Progress | undefined;
  className?: string;
}) {
  if (progress === undefined) return null;
  const { done, total } = progress;
  return (
    <span
      title={`${done} of ${total} subtasks done`}
      className={cn(
        "flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      <ListTreeIcon className="size-3.5" />
      {done}/{total}
    </span>
  );
}

/** "↑ HM-1" on a subtask that a view lists on its own, with the parent's title on hover. */
export function ParentChip({ snapshot, task }: { snapshot: WorkspaceSnapshot; task: Task }) {
  if (task.parent === null) return null;
  const parent = snapshot.tasks.find((entry) => entry.id === task.parent);
  return (
    <span
      title={parent && `Subtask of ${parent.title}`}
      className="flex shrink-0 items-center gap-0.5 font-mono text-xs text-muted-foreground"
    >
      <CornerLeftUpIcon className="size-3.5" />
      {task.parent}
    </span>
  );
}

function TaskLink({
  workspace,
  task,
  className,
  children,
}: {
  workspace: string;
  task: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/w/$workspace"
      params={{ workspace }}
      search={(prev) => ({ ...prev, task })}
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
    >
      {children}
    </Link>
  );
}

/** ", including 3 subtasks" for the delete confirmation of a task with subtasks. */
export function SubtasksGoing({ snapshot, task }: { snapshot: WorkspaceSnapshot; task: Task }) {
  const count = descendantCount(snapshot.tasks, task.id);
  if (count === 0) return null;
  return <>, including {count === 1 ? "1 subtask" : `${count} subtasks`}</>;
}

/** The way back from a subtask's detail to its parent's. */
export function ParentLink({
  workspace,
  snapshot,
  task,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
}) {
  const parent = snapshot.tasks.find((entry) => entry.id === task.parent);
  if (parent === undefined) return null;
  return (
    <TaskLink
      workspace={workspace}
      task={parent.id}
      className="flex h-8 shrink-0 items-center gap-1.5 border-b px-4 text-xs text-muted-foreground hover:text-foreground"
    >
      <CornerLeftUpIcon className="size-3.5 shrink-0" />
      <span className="shrink-0 font-mono">{parent.id}</span>
      <span className="truncate">{parent.title}</span>
    </TaskLink>
  );
}

/**
 * A task's direct subtasks, each with a checkbox for done (a completed status) or open, and a
 * field that adds one.
 */
export function TaskSubtasks({
  workspace,
  snapshot,
  task,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
}) {
  const move = useMoveTask(workspace);
  const create = useCreateTask(workspace);
  const [title, setTitle] = useState("");
  const completed = firstStatus(snapshot.statuses, "completed");
  const open = defaultStatus(snapshot.statuses);
  const subtasks = subtasksOf(snapshot.tasks, task.id);
  const progress = subtaskProgress(snapshot);
  const own = progress.get(task.id);
  const isDone = (subtask: Task) =>
    snapshot.statuses.find((status) => status.id === subtask.status)?.category === "completed";

  const setDone = (subtask: Task, done: boolean) => {
    const target = done ? completed : open;
    if (target !== undefined && target.id !== subtask.status)
      move.mutate({ id: subtask.id, move: { status: target.id } });
  };

  const add = () => {
    const trimmed = title.trim();
    if (trimmed === "") return;
    create.mutate(
      { title: trimmed, parent: task.id },
      { onSuccess: () => setTitle((current) => (current === title ? "" : current)) },
    );
  };

  return (
    <section aria-label="Subtasks" className="flex max-h-[45%] shrink-0 flex-col border-t pt-1.5">
      <h2 className="flex h-7 shrink-0 items-center gap-2 px-4 font-mono text-xs text-muted-foreground lowercase">
        subtasks
        {own && (
          <span className="text-muted-foreground/70">
            {own.done}/{own.total}
          </span>
        )}
      </h2>
      {subtasks.length > 0 && (
        <ScrollArea className="min-h-0">
          <ul className="flex flex-col px-2">
            {subtasks.map((subtask) => (
              <li
                key={subtask.id}
                className="flex h-8 items-center gap-2.5 rounded-md px-2 hover:bg-row-hover"
              >
                <Checkbox
                  checked={isDone(subtask)}
                  disabled={completed === undefined}
                  onCheckedChange={(checked) => setDone(subtask, checked === true)}
                  aria-label={`${subtask.title}: ${isDone(subtask) ? "done" : "open"}`}
                />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {subtask.id}
                </span>
                <TaskLink
                  workspace={workspace}
                  task={subtask.id}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-sm",
                    isDone(subtask) && "text-muted-foreground line-through",
                  )}
                >
                  {subtask.title}
                </TaskLink>
                <SubtaskCount progress={progress.get(subtask.id)} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      <form
        className="shrink-0 px-3 pt-1 pb-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <PlusIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="New subtask title"
            placeholder="Add a subtask"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setTitle("");
                event.currentTarget.blur();
              }
            }}
          />
        </InputGroup>
      </form>
    </section>
  );
}
