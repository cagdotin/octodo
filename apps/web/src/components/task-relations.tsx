import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { LINK_KINDS, isClosedCategory } from "@octodo/core/layout";
import { useNavigate } from "@tanstack/react-router";
import { LockIcon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { MentionTarget } from "@/components/markdown-editor/mentions";
import { StatusIcon } from "@/components/task-bits";
import { TaskLink } from "@/components/task-subtasks";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUpdateTask } from "@/lib/api";
import { openBlockers, statusMap } from "@/lib/tasks";
import { cn } from "@/lib/utils";

const [BLOCKED_BY] = LINK_KINDS;

/** "HM-3 Paint the bedroom, HM-9 (missing)": the tasks behind ids, for tooltips. */
const describe = (snapshot: WorkspaceSnapshot, ids: ReadonlyArray<string>) =>
  ids
    .map((id) => {
      const task = snapshot.tasks.find((entry) => entry.id === id);
      return task === undefined ? `${id} (missing)` : `${id} ${task.title}`;
    })
    .join(", ");

/** A lock on a blocked task's row or card, naming the blockers still open or missing on hover. */
export function BlockedChip({ snapshot, task }: { snapshot: WorkspaceSnapshot; task: Task }) {
  if (!task.blocked) return null;
  const label = `Blocked by ${describe(snapshot, openBlockers(snapshot, task.blockedBy))}`;
  return (
    <span title={label} className="flex shrink-0 items-center text-muted-foreground">
      <LockIcon className="size-3.5" aria-label={label} />
    </span>
  );
}

/**
 * What the body editor of task `own` needs for `[[HM-3]]`: every task's title, and a way to open
 * one.
 */
export function useMentions(workspace: string, snapshot: WorkspaceSnapshot, own: string) {
  const navigate = useNavigate();
  const mentionTargets = useMemo(() => {
    const statuses = statusMap(snapshot.statuses);
    return new Map<string, MentionTarget>(
      snapshot.tasks.map((task) => [
        task.id,
        {
          id: task.id,
          title: task.title,
          closed: isClosedCategory(statuses.get(task.status)?.category),
          own: task.id === own,
        },
      ]),
    );
  }, [snapshot.tasks, snapshot.statuses, own]);
  const onOpenMention = (task: string) =>
    void navigate({
      to: "/w/$workspace",
      params: { workspace },
      search: (prev) => ({ ...prev, task }),
    });
  return { mentionTargets, onOpenMention };
}

/** One linked task: its status, id and title, or a placeholder for an id that matches no task. */
function RelatedTask({
  workspace,
  snapshot,
  id,
  onRemove,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  id: string;
  onRemove?: () => void;
}) {
  const task = snapshot.tasks.find((entry) => entry.id === id);
  const category = task && statusMap(snapshot.statuses).get(task.status)?.category;
  const closed = isClosedCategory(category);
  return (
    <li className="group/related flex h-8 items-center gap-2.5 rounded-md px-2 hover:bg-row-hover">
      {task === undefined ? (
        <span className="size-3.5 shrink-0 rounded-full border border-dashed border-muted-foreground/60" />
      ) : (
        <StatusIcon category={category} />
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{id}</span>
      {task === undefined ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground italic">Missing task</span>
      ) : (
        <TaskLink
          workspace={workspace}
          task={id}
          className={cn(
            "min-w-0 flex-1 truncate rounded-sm",
            closed && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </TaskLink>
      )}
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground opacity-0 group-hover/related:opacity-100 focus-visible:opacity-100"
          aria-label={`Remove ${id}`}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      )}
    </li>
  );
}

/** Searches the workspace's tasks by id or title and picks one. */
function TaskPicker({
  snapshot,
  exclude,
  onPick,
}: {
  snapshot: WorkspaceSnapshot;
  exclude: ReadonlySet<string>;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const statuses = statusMap(snapshot.statuses);
  const candidates = snapshot.tasks.filter((task) => !exclude.has(task.id));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto text-muted-foreground"
          aria-label="Add a blocker"
        >
          <PlusIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" collisionPadding={8} className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Blocked by…" />
          <CommandList>
            <CommandEmpty>No tasks found</CommandEmpty>
            {candidates.map((task) => (
              <CommandItem
                key={task.id}
                value={`${task.id} ${task.title}`}
                onSelect={() => {
                  onPick(task.id);
                  setOpen(false);
                }}
              >
                <StatusIcon category={statuses.get(task.status)?.category} />
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.id}</span>
                <span className="truncate">{task.title}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex h-7 items-center gap-2 px-2 font-mono text-xs text-muted-foreground lowercase">
      {children}
    </h3>
  );
}

/**
 * The tasks this one waits for, with a picker to add and a button to remove each; then the tasks
 * waiting for it and the tasks whose body mentions it, which their own files store.
 */
export function TaskRelations({
  workspace,
  snapshot,
  task,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
}) {
  const update = useUpdateTask(workspace);
  const setBlockedBy = (blockedBy: ReadonlyArray<string>) =>
    update.mutate({ id: task.id, patch: { blocked_by: blockedBy } });
  const others: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    [BLOCKED_BY.reverseLabel, task.blocks],
    ["Mentioned in", task.mentionedIn],
  ];
  return (
    <section aria-label="Relations" className="flex max-h-[35%] shrink-0 flex-col border-t pt-1.5">
      <ScrollArea className="min-h-0">
        <div className="flex flex-col px-2 pb-1.5">
          <Heading>
            {BLOCKED_BY.label}
            {task.blocked && <LockIcon className="size-3" aria-label="Blocked" />}
            <TaskPicker
              snapshot={snapshot}
              exclude={new Set([task.id, ...task.blockedBy])}
              onPick={(id) => setBlockedBy([...task.blockedBy, id])}
            />
          </Heading>
          {task.blockedBy.length > 0 && (
            <ul className="flex flex-col">
              {task.blockedBy.map((id) => (
                <RelatedTask
                  key={id}
                  workspace={workspace}
                  snapshot={snapshot}
                  id={id}
                  onRemove={() => setBlockedBy(task.blockedBy.filter((other) => other !== id))}
                />
              ))}
            </ul>
          )}
          {others.map(
            ([label, ids]) =>
              ids.length > 0 && (
                <div key={label}>
                  <Heading>{label}</Heading>
                  <ul className="flex flex-col">
                    {ids.map((id) => (
                      <RelatedTask key={id} workspace={workspace} snapshot={snapshot} id={id} />
                    ))}
                  </ul>
                </div>
              ),
          )}
        </div>
      </ScrollArea>
    </section>
  );
}
