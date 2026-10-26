import type { StatusDefinition, Task, WorkspaceSnapshot } from "@tasksmd/core";
import { Link } from "@tanstack/react-router";
import { InboxIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import {
  ListChip,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
  TagChips,
  TaskDate,
} from "@/components/task-bits";
import { TaskComposer } from "@/components/task-composer";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { isClosedCategory } from "@/lib/tasks";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  /** The statuses the current tab and display options show, in workspace order. */
  statuses: ReadonlyArray<StatusDefinition>;
  tasks: ReadonlyArray<Task>;
  selected: string | undefined;
  list: string | undefined;
  /** The status whose group has the new-task row open, if any. */
  composing: string | null;
  onCompose: (status: string | null) => void;
}

/** A small filled disclosure triangle, like Linear's. */
export function Disclosure({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 fill-current text-muted-foreground transition-transform",
        className,
      )}
    >
      <path d="M3 1.8 7.4 5 3 8.2Z" />
    </svg>
  );
}

export function ListView({
  workspace,
  snapshot,
  statuses,
  tasks,
  selected,
  list,
  composing,
  onCompose,
}: Props) {
  // Remember toggles per status id; untouched groups use the category default.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = statuses
    .map((status) => ({ status, tasks: tasks.filter((task) => task.status === status.id) }))
    .filter((group) => group.tasks.length > 0 || group.status.id === composing);
  // Ids line up in a column as wide as the longest one.
  const idWidth = `${Math.max(4, ...tasks.map((task) => task.id.length))}ch`;

  if (groups.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <InboxIcon />
          </EmptyMedia>
          <EmptyTitle>No tasks</EmptyTitle>
          <EmptyDescription>
            Nothing matches this view. Press <span className="font-medium">N</span> to add a task.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="@container flex flex-col gap-0.5 px-2 pt-1 pb-24 md:px-3">
        {groups.map(({ status, tasks: items }) => {
          const isOpen =
            status.id === composing || (open[status.id] ?? !isClosedCategory(status.category));
          return (
            <Collapsible
              key={status.id}
              open={isOpen}
              onOpenChange={(value) => setOpen((prev) => ({ ...prev, [status.id]: value }))}
              className="flex flex-col gap-0.5"
            >
              <div className="flex h-9 items-center rounded-md bg-band pr-1.5">
                <CollapsibleTrigger className="group flex h-full flex-1 items-center gap-2.5 rounded-md pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                  <Disclosure className="group-data-[state=open]:rotate-90" />
                  <StatusIcon category={status.category} />
                  <span className="font-medium">{status.name}</span>
                  <span className="text-muted-foreground tabular-nums">{items.length}</span>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`New task in ${status.name}`}
                  onClick={() => onCompose(status.id)}
                >
                  <PlusIcon />
                </Button>
              </div>
              <CollapsibleContent className="flex flex-col">
                {status.id === composing && (
                  <TaskComposer
                    workspace={workspace}
                    snapshot={snapshot}
                    status={status.id}
                    list={list}
                    onClose={() => onCompose(null)}
                    idWidth={idWidth}
                  />
                )}
                <ul className="flex flex-col">
                  {items.map((task) => (
                    <TaskRow
                      key={task.id}
                      workspace={workspace}
                      snapshot={snapshot}
                      task={task}
                      active={task.id === selected}
                      idWidth={idWidth}
                    />
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function TaskRow({
  workspace,
  snapshot,
  task,
  active,
  idWidth,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  active: boolean;
  idWidth: string;
}) {
  return (
    <li
      data-active={active || undefined}
      className="group/row relative flex h-9 items-center gap-1.5 rounded-md pr-3 pl-1.5 transition-colors hover:bg-row-hover data-active:bg-accent md:pl-[18px]"
    >
      <PriorityMenu workspace={workspace} task={task} />
      <span
        className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline"
        style={{ width: idWidth }}
      >
        {task.id}
      </span>
      <StatusMenu workspace={workspace} snapshot={snapshot} task={task} />
      <Link
        to="/w/$workspace"
        params={{ workspace }}
        search={(prev) => ({ ...prev, task: task.id })}
        className="min-w-0 flex-1 truncate pl-0.5 outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
      >
        {task.title}
      </Link>
      {/* Chips make way for the title as the list narrows (details panel open, small windows). */}
      <span className="hidden min-w-0 shrink-0 items-center gap-1 @lg:flex">
        <TagChips tags={task.tags} />
        <span className="hidden @3xl:contents">
          <ListChip lists={snapshot.lists} list={task.list} />
        </span>
      </span>
      <TaskDate task={task} className="w-14 text-right" />
    </li>
  );
}
