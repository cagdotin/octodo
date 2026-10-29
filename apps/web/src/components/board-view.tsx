import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusDefinition, Task, WorkspaceSnapshot } from "@octodo/contract";
import { useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import { PlusIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { COLUMN_PREFIX, useTaskColumns } from "@/components/drag-and-drop";
import { type DragData, type DropData } from "@/lib/drag";
import {
  ChecklistCount,
  ListChip,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
  TagPill,
  TaskDate,
} from "@/components/task-bits";
import { TaskComposer } from "@/components/task-composer";
import { BlockedChip } from "@/components/task-relations";
import { ParentChip, SubtaskCount } from "@/components/task-subtasks";
import { Button } from "@octodo/ui/components/button";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { subtaskProgress, type Progress } from "@/lib/tasks";
import { cn } from "@octodo/ui/lib/utils";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  /** The statuses the current tab and display options show, in workspace order. */
  statuses: ReadonlyArray<StatusDefinition>;
  tasks: ReadonlyArray<Task>;
  selected: string | undefined;
  list: string | undefined;
  composing: string | null;
  onCompose: (status: string | null) => void;
}

export function BoardView({
  workspace,
  snapshot,
  statuses,
  tasks,
  selected,
  list,
  composing,
  onCompose,
}: Props) {
  const { columns, byId } = useTaskColumns({
    workspace,
    statuses: snapshot.statuses,
    tasks,
  });
  const progress = useMemo(() => subtaskProgress(snapshot), [snapshot]);

  return (
    <ScrollArea fill className="min-h-0 flex-1">
      <div className="flex h-full w-max min-w-full divide-x">
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            ids={columns[status.id] ?? []}
            byId={byId}
            progress={progress}
            workspace={workspace}
            snapshot={snapshot}
            selected={selected}
            composer={
              status.id === composing ? (
                <TaskComposer
                  workspace={workspace}
                  snapshot={snapshot}
                  status={status.id}
                  list={list}
                  onClose={() => onCompose(null)}
                  variant="card"
                />
              ) : null
            }
            onCompose={() => onCompose(status.id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function BoardColumn({
  status,
  ids,
  byId,
  progress,
  workspace,
  snapshot,
  selected,
  composer,
  onCompose,
}: {
  status: StatusDefinition;
  ids: Array<string>;
  byId: Map<string, Task>;
  progress: ReadonlyMap<string, Progress>;
  workspace: string;
  snapshot: WorkspaceSnapshot;
  selected: string | undefined;
  composer: ReactNode;
  onCompose: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${COLUMN_PREFIX}${status.id}`,
    data: { accepts: ["task"], column: status.id } satisfies DropData,
  });
  return (
    <section className="flex w-[280px] shrink-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4">
        <StatusIcon category={status.category} />
        <span className="truncate text-[13px] font-medium">{status.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          aria-label={`New task in ${status.name}`}
          onClick={onCompose}
        >
          <PlusIcon />
        </Button>
      </header>
      <SortableContext id={status.id} items={ids} strategy={verticalListSortingStrategy}>
        <ScrollArea
          ref={setNodeRef}
          className={cn("min-h-24 flex-1 transition-colors", isOver && "bg-accent/40")}
        >
          <div className="flex flex-col gap-1.5 px-2 pb-2">
            {composer}
            {ids.map((id, index) => {
              const task = byId.get(id);
              return task ? (
                <SortableCard
                  index={index}
                  key={id}
                  workspace={workspace}
                  snapshot={snapshot}
                  task={task}
                  subtasks={progress.get(id)}
                  active={id === selected}
                />
              ) : null;
            })}
          </div>
        </ScrollArea>
      </SortableContext>
    </section>
  );
}

function SortableCard({
  index,
  ...props
}: {
  index: number;
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  subtasks: Progress | undefined;
  active: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: {
      type: "task",
      task: props.task,
      overlay: () => <TaskCard {...props} active={false} overlay />,
      accepts: ["task"],
    } satisfies DragData & DropData,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <m.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 40,
          delay: Math.min(index, 12) * 0.025,
        }}
      >
        <TaskCard {...props} />
      </m.div>
    </div>
  );
}

function TaskCard({
  workspace,
  snapshot,
  task,
  subtasks,
  active = false,
  overlay = false,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  subtasks: Progress | undefined;
  active?: boolean;
  overlay?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      data-active={active || undefined}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-card-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-accent/40 active:scale-[0.98] data-active:border-foreground/30 data-active:bg-accent",
        overlay && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <StatusMenu workspace={workspace} snapshot={snapshot} task={task} className="-m-1" />
        <span className="font-mono">{task.id}</span>
        <span className="ml-auto flex items-center gap-2">
          <BlockedChip snapshot={snapshot} task={task} />
          <ParentChip snapshot={snapshot} task={task} />
          <SubtaskCount progress={subtasks} />
          <ChecklistCount body={task.body} />
        </span>
      </div>
      <button
        type="button"
        tabIndex={-1}
        onClick={() =>
          void navigate({
            to: "/w/$workspace",
            params: { workspace },
            search: (prev) => ({ ...prev, task: task.id }),
          })
        }
        className="line-clamp-2 min-w-0 text-left text-[13px] leading-snug break-words outline-none after:absolute after:inset-0 after:rounded-lg"
      >
        {task.title}
      </button>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <PriorityMenu workspace={workspace} task={task} className="-m-1" />
        {task.tags.slice(0, 2).map((tag) => (
          <TagPill key={tag} tag={tag} />
        ))}
        <ListChip lists={snapshot.lists} list={task.list} />
        <TaskDate task={task} className="ml-auto font-sans tabular-nums" />
      </div>
    </div>
  );
}
