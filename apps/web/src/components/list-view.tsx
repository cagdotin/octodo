import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { EntryDay, StatusDefinition, Task, WorkspaceSnapshot } from "@octodo/contract";
import { isClosedCategory } from "@octodo/contract/rules";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, InboxIcon, PlusIcon } from "lucide-react";
import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  COLUMN_PREFIX,
  useTaskColumns,
  type DragData,
  type DropData,
} from "@/components/drag-and-drop";
import {
  ChecklistCount,
  ListChip,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
  TagPill,
  TaskDate,
} from "@/components/task-bits";
import { PANE_ROW } from "@octodo/ui/components/pane";
import { enabledSections } from "@/components/section";
import { TaskComposer } from "@/components/task-composer";
import { BlockedChip } from "@/components/task-relations";
import { ParentChip, SubtaskCount } from "@/components/task-subtasks";
import { Button } from "@octodo/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@octodo/ui/components/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@octodo/ui/components/empty";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { useToday } from "@octodo/ui/hooks/use-today";
import { dueInfo } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { listViewOrder, subtaskProgress, type Progress } from "@/lib/tasks";

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
  /** Entries of sections the date views list after the tasks, read-only (decision 0027). */
  entries: ReadonlyArray<EntryDay>;
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
  entries,
}: Props) {
  // Remember toggles per status id; untouched groups use the category default.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { columns, byId } = useTaskColumns({ workspace, statuses: snapshot.statuses, tasks });
  const progress = useMemo(() => subtaskProgress(snapshot), [snapshot]);
  // Groups come from the saved tasks, so one emptied mid-drag stays until the drop lands.
  const groups = listViewOrder(statuses).filter(
    (status) => tasks.some((task) => task.status === status.id) || status.id === composing,
  );
  // Ids line up in a column as wide as the longest one.
  const idWidth = `${Math.max(4, ...[...tasks, ...entries].map((row) => row.id.length))}ch`;

  if (groups.length === 0 && entries.length === 0) {
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
      <div className="@container flex flex-col pb-24">
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
              <div className="sticky top-0 z-20 flex h-9 items-center border-b bg-background pe-2">
                <CollapsibleTrigger className="group flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 ps-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                  <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform duration-200 ease-out group-data-panel-open:rotate-90" />
                  <StatusIcon category={status.category} />
                  <span className="text-[13px] font-medium">{status.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
                </CollapsibleTrigger>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`New task in ${status.name}`}
                        onClick={() => onCompose(status.id)}
                      />
                    }
                  >
                    <PlusIcon />
                  </TooltipTrigger>
                  <TooltipContent>New task in {status.name}</TooltipContent>
                </Tooltip>
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
                          subtasks={progress.get(id)}
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
        {enabledSections(snapshot).map(({ id, web }) => {
          const rows = entries.filter((entry) => entry.section === id);
          return rows.length === 0 ? null : (
            <section key={id} aria-label={web.label} className="flex flex-col">
              <h2 className="sticky top-0 z-20 flex h-9 items-center gap-2 border-b bg-background ps-4">
                <web.Icon className="size-3.5 text-muted-foreground" />
                <span className="text-[13px] font-medium">{web.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{rows.length}</span>
              </h2>
              <ul className="flex flex-col">
                {rows.map((entry) => {
                  const fields = snapshot.entries?.find(({ id }) => id === entry.id)?.fields;
                  return (
                    <EntryDayRow
                      key={entry.id}
                      workspace={workspace}
                      entry={entry}
                      icon={
                        fields === undefined ? (
                          <web.Icon className="size-3.5" />
                        ) : (
                          <web.EntryIcon fields={fields} className="size-3.5" />
                        )
                      }
                      idWidth={idWidth}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/** An entry of a section on its day: no checkbox, its section's icon, and a link to its page. */
function EntryDayRow({
  workspace,
  entry,
  icon,
  idWidth,
}: {
  workspace: string;
  entry: EntryDay;
  icon: ReactNode;
  idWidth: string;
}) {
  const due = dueInfo(entry.day, useToday());
  return (
    <li className={PANE_ROW}>
      <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span
        className="hidden shrink-0 font-mono text-xs text-muted-foreground @md:block"
        style={{ width: idWidth }}
      >
        {entry.id}
      </span>
      <Link
        to="/w/$workspace/$section"
        params={{ workspace, section: entry.section }}
        search={{ entry: entry.id }}
        draggable={false}
        className="min-w-0 flex-1 truncate text-[13px] outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      >
        {entry.title}
      </Link>
      <span
        className={cn(
          "w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums",
          due?.today && "text-foreground",
        )}
      >
        {due?.label}
      </span>
    </li>
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
      className={cn("flex flex-col transition-colors", isOver && "bg-accent/40")}
    >
      {children}
    </Collapsible>
  );
}

function SortableRow(props: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  subtasks: Progress | undefined;
  active: boolean;
  idWidth: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: {
      type: "task",
      task: props.task,
      overlay: () => (
        <div className="flex h-9 w-fit max-w-96 items-center gap-3 rounded-md border bg-popover px-4 text-[13px] text-popover-foreground shadow-lg">
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
  subtasks,
  active,
  idWidth,
  className,
  ...props
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  subtasks: Progress | undefined;
  active: boolean;
  idWidth: string;
} & ComponentProps<"li">) {
  return (
    <li
      data-active={active || undefined}
      className={cn(PANE_ROW, "data-active:bg-accent", className)}
      {...props}
    >
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-foreground" />}
      <PriorityMenu
        workspace={workspace}
        task={task}
        className={cn(
          "-mx-1",
          task.priority === "none" && "opacity-40 group-hover/row:opacity-100",
        )}
      />
      <span
        className="hidden shrink-0 font-mono text-xs text-muted-foreground @md:block"
        style={{ width: idWidth }}
      >
        {task.id}
      </span>
      <StatusMenu workspace={workspace} snapshot={snapshot} task={task} className="-mx-1" />
      <Link
        to="/w/$workspace"
        params={{ workspace }}
        search={(prev) => ({ ...prev, task: task.id })}
        draggable={false}
        className="min-w-0 flex-1 truncate text-[13px] outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
      >
        {task.title}
      </Link>
      <BlockedChip snapshot={snapshot} task={task} />
      <ParentChip snapshot={snapshot} task={task} />
      <SubtaskCount progress={subtasks} />
      <ChecklistCount body={task.body} />
      {/* Chips make way for the title as the list narrows (details panel open, small windows). */}
      <span className="hidden min-w-0 shrink-0 items-center gap-1.5 @2xl:flex">
        {task.tags.slice(0, 2).map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        {task.tags.length > 2 && (
          <span className="text-[11px] text-muted-foreground">+{task.tags.length - 2}</span>
        )}
      </span>
      <span className="hidden @4xl:contents">
        <ListChip lists={snapshot.lists} list={task.list} />
      </span>
      <TaskDate task={task} className="w-14 text-right font-sans tabular-nums" />
    </li>
  );
}
