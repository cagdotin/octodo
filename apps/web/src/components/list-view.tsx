import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusDefinition, Task, WorkspaceSnapshot } from "@octodo/core";
import { Link } from "@tanstack/react-router";
import { InboxIcon, PlusIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  COLUMN_PREFIX,
  useTaskColumns,
  type DragData,
  type DropData,
} from "@/components/drag-and-drop";
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
import { isClosedCategory, listViewOrder } from "@/lib/tasks";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  /** The statuses the current tab and display options show, in workflow order. */
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
  const { columns, byId } = useTaskColumns({ workspace, statuses: snapshot.statuses, tasks });
  // Groups come from the saved tasks, so one emptied mid-drag stays until the drop lands.
  const groups = listViewOrder(statuses).filter(
    (status) => tasks.some((task) => task.status === status.id) || status.id === composing,
  );
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
      <div className="@container flex flex-col px-2 pt-1 pb-24 md:px-3">
        {groups.map((status) => {
          const ids = columns[status.id] ?? [];
          const isOpen =
            status.id === composing || (open[status.id] ?? !isClosedCategory(status.category));
          return (
            <StatusGroup
              key={status.id}
              status={status}
              open={isOpen}
              onOpenChange={(value) => setOpen((prev) => ({ ...prev, [status.id]: value }))}
            >
              <div className="group/header relative flex h-9 items-center">
                <CollapsibleTrigger className="group flex h-full flex-1 items-center gap-2.5 rounded-md pr-10 pl-1 text-left transition-colors outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring/50 md:pl-[3px]">
                  <Disclosure className="opacity-0 group-hover/header:opacity-100 group-focus-visible:opacity-100 group-data-[state=closed]:opacity-100 group-data-[state=open]:rotate-90" />
                  <StatusIcon category={status.category} />
                  <span className="font-medium">{status.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{ids.length}</span>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-1.5 text-muted-foreground opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
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
                <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col">
                    {ids.map((id) => {
                      const task = byId.get(id);
                      return task ? (
                        <SortableRow
                          key={id}
                          workspace={workspace}
                          snapshot={snapshot}
                          task={task}
                          active={id === selected}
                          idWidth={idWidth}
                        />
                      ) : null;
                    })}
                  </ul>
                </SortableContext>
              </CollapsibleContent>
            </StatusGroup>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** A status group, which also takes tasks dropped on its header or below its last row. */
function StatusGroup({
  status,
  open,
  onOpenChange,
  children,
}: {
  status: StatusDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${status.id}`,
    data: { accepts: ["task"], column: status.id } satisfies DropData,
  });
  return (
    <Collapsible
      ref={setNodeRef}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("flex flex-col rounded-md", isOver && "bg-row-hover/60")}
    >
      {children}
    </Collapsible>
  );
}

function SortableRow(props: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  active: boolean;
  idWidth: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: {
      type: "task",
      task: props.task,
      overlay: () => (
        <div className="flex h-7 w-fit max-w-80 items-center gap-2 rounded-md border bg-popover px-2.5 text-sm text-popover-foreground shadow-lg">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{props.task.id}</span>
          <span className="truncate">{props.task.title}</span>
        </div>
      ),
      atPointer: true,
      accepts: ["task"],
    } satisfies DragData & DropData,
  });
  return (
    <TaskRow
      {...props}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    />
  );
}

function TaskRow({
  workspace,
  snapshot,
  task,
  active,
  idWidth,
  className,
  ...props
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  active: boolean;
  idWidth: string;
} & ComponentProps<"li">) {
  return (
    <li
      data-active={active || undefined}
      className={cn(
        "group/row relative flex h-9 items-center gap-1.5 rounded-md pr-3 pl-1.5 transition-colors hover:bg-row-hover data-active:rounded-l-none data-active:bg-accent data-active:shadow-[inset_2px_0_0_var(--foreground)] md:pl-[18px]",
        className,
      )}
      {...props}
    >
      <PriorityMenu
        workspace={workspace}
        task={task}
        // An unset priority stays out of the way until the row is pointed at.
        className={cn(
          task.priority === "none" &&
            "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100",
        )}
      />
      <span
        className="hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline"
        style={{ width: idWidth }}
      >
        {task.id}
      </span>
      <StatusMenu workspace={workspace} snapshot={snapshot} task={task} />
      <Link
        to="/w/$workspace"
        params={{ workspace }}
        search={(prev) => ({ ...prev, task: task.id })}
        draggable={false}
        className="min-w-0 flex-1 truncate pl-0.5 outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
      >
        {task.title}
      </Link>
      {/* Chips make way for the title as the list narrows (details panel open, small windows). */}
      <span className="mr-2 hidden min-w-0 shrink-0 items-center gap-2 @lg:flex">
        <TagChips tags={task.tags} />
        <span className="hidden @3xl:contents">
          <ListChip lists={snapshot.lists} list={task.list} />
        </span>
      </span>
      <TaskDate task={task} className="w-14 text-right" />
    </li>
  );
}
