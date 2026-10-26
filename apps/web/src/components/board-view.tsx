import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusDefinition, Task, WorkspaceSnapshot } from "@octodo/core";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
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
import { cn } from "@/lib/utils";

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto px-2 pt-1 pb-3 md:px-3">
        {statuses.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            ids={columns[status.id] ?? []}
            byId={byId}
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
    </div>
  );
}

function BoardColumn({
  status,
  ids,
  byId,
  workspace,
  snapshot,
  selected,
  composer,
  onCompose,
}: {
  status: StatusDefinition;
  ids: Array<string>;
  byId: Map<string, Task>;
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
    <section className="flex w-[300px] shrink-0 flex-col rounded-lg bg-band/60">
      <header className="flex h-10 shrink-0 items-center gap-2 pr-1.5 pl-3">
        <StatusIcon category={status.category} />
        <span className="truncate font-medium">{status.name}</span>
        <span className="text-muted-foreground tabular-nums">{ids.length}</span>
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
        <div
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto rounded-b-lg px-1.5 pb-1.5 transition-colors",
            isOver && "bg-band",
          )}
        >
          {composer}
          {ids.map((id) => {
            const task = byId.get(id);
            return task ? (
              <SortableCard
                key={id}
                workspace={workspace}
                snapshot={snapshot}
                task={task}
                active={id === selected}
              />
            ) : null;
          })}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard(props: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
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
      <TaskCard {...props} />
    </div>
  );
}

function TaskCard({
  workspace,
  snapshot,
  task,
  active = false,
  overlay = false,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  active?: boolean;
  overlay?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div
      data-active={active || undefined}
      className={cn(
        "relative flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-xs transition-colors hover:border-foreground/15 data-active:border-primary/50 data-active:ring-1 data-active:ring-primary/30",
        overlay && "rotate-1 shadow-lg",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">{task.id}</span>
        <TaskDate task={task} className="ml-auto" />
      </div>
      <div className="flex items-start gap-1.5">
        <StatusMenu workspace={workspace} snapshot={snapshot} task={task} className="-my-1 -ml-1" />
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
          className="line-clamp-2 min-w-0 flex-1 text-left leading-snug font-medium break-words outline-none after:absolute after:inset-0 after:rounded-lg"
        >
          {task.title}
        </button>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <PriorityMenu workspace={workspace} task={task} className="-ml-1" />
        <TagChips tags={task.tags} />
        <ListChip lists={snapshot.lists} list={task.list} />
      </div>
    </div>
  );
}
