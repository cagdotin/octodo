import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDndMonitor,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DroppableContainer,
  type Modifier,
  type Over,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { getEventCoordinates } from "@dnd-kit/utilities";
import type { List, StatusDefinition, Task } from "@octodo/core";
import { useMemo, useState, type ReactNode } from "react";
import { useMoveTask } from "@/lib/api";
import { neighbours } from "@/lib/tasks";

/**
 * One drag context for the whole workspace page, so a task dragged out of the list or board can
 * land on a list in the sidebar. Draggables say what they are in `data`, droppables what they
 * take; each part of the page listens with `useDndMonitor` for the drags it cares about.
 */
export type DragKind = "task" | "list";

interface DragBase {
  readonly overlay: () => ReactNode;
  /**
   * Pin the overlay's top-left corner to the pointer, for small overlays dragged from wide rows.
   * Without it the overlay keeps the grab offset, which suits cards the size of their overlay.
   */
  readonly atPointer?: boolean;
}

export type DragData =
  | (DragBase & { readonly type: "task"; readonly task: Task })
  | (DragBase & { readonly type: "list"; readonly list: List });

export interface DropData {
  readonly accepts: ReadonlyArray<DragKind>;
  /** A status group or column, which loses to the task rows inside it. */
  readonly column?: string;
  /** A list in the sidebar (null for "No list"). */
  readonly list?: string | null;
  /** Kinds this only takes from right under the pointer, never as the nearest fallback. */
  readonly pointerOnly?: ReadonlyArray<DragKind>;
}

export const dragData = (entity: { data: { current?: unknown } } | null | undefined) =>
  entity?.data.current as DragData | undefined;

export const dropData = (entity: { data: { current?: unknown } } | null | undefined) =>
  entity?.data.current as DropData | undefined;

const accepts = (container: DroppableContainer, kind: DragKind | undefined) =>
  kind !== undefined && (dropData(container)?.accepts.includes(kind) ?? false);

/**
 * Whatever is under the pointer wins, preferring rows and cards over the column they sit in;
 * closest corners only as a fallback (keyboard dragging, pointer between targets). Corners alone
 * pick cards in the neighbouring column when the dragged card is wide.
 */
const collision: CollisionDetection = (args) => {
  const kind = dragData(args.active)?.type;
  const containers = args.droppableContainers.filter((container) => accepts(container, kind));
  const hits = pointerWithin({ ...args, droppableContainers: containers });
  const specific = hits.filter(
    (hit) => dropData(hit.data?.["droppableContainer"])?.column === undefined,
  );
  if (specific.length > 0) return specific;
  if (hits.length > 0) return hits;
  return closestCorners({
    ...args,
    droppableContainers: containers.filter(
      (container) => !(kind && dropData(container)?.pointerOnly?.includes(kind)),
    ),
  });
};

const atPointer: Modifier = ({ active, activatorEvent, draggingNodeRect, transform }) => {
  const start = activatorEvent === null ? null : getEventCoordinates(activatorEvent);
  if (!dragData(active)?.atPointer || draggingNodeRect === null || start === null) return transform;
  return {
    ...transform,
    x: transform.x + start.x - draggingNodeRect.left + 8,
    y: transform.y + start.y - draggingNodeRect.top - 14,
  };
};

/**
 * Rows and list entries are links, and releasing a drag over one would also click it. Swallows
 * the click that the end of a drag produces, and nothing after it.
 */
const swallowNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
};

export function DragAndDrop({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DragData | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    // Space only: Enter on a focused row should still open it.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active }) => setActive(dragData(active) ?? null)}
      onDragEnd={() => {
        setActive(null);
        swallowNextClick();
      }}
      onDragCancel={() => setActive(null)}
    >
      {children}
      <DragOverlay dropAnimation={null} modifiers={[atPointer]}>
        {active?.overlay()}
      </DragOverlay>
    </DndContext>
  );
}

/** Task ids per status, in the order they show. */
export type Columns = Record<string, Array<string>>;

export const COLUMN_PREFIX = "column:";

/**
 * Task dragging for a view that groups tasks by status (the list's groups, the board's columns).
 * While a drag is on, a local copy of the columns moves the task between groups as the pointer
 * crosses them; dropping saves the status and the place among its neighbours.
 */
export function useTaskColumns({
  workspace,
  statuses,
  tasks,
}: {
  workspace: string;
  statuses: ReadonlyArray<StatusDefinition>;
  tasks: ReadonlyArray<Task>;
}) {
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const derived = useMemo(() => {
    const columns: Columns = {};
    for (const status of statuses) columns[status.id] = [];
    for (const task of tasks) columns[task.status]?.push(task.id);
    return columns;
  }, [statuses, tasks]);
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const move = useMoveTask(workspace);

  /** The status a drop target belongs to: a column itself, or the column of a task in it. */
  const containerOf = (cols: Columns, target: Active | Over): string | undefined => {
    const column = dropData(target)?.column;
    if (column !== undefined) return column;
    const key = String(target.id as UniqueIdentifier);
    return Object.keys(cols).find((status) => cols[status]!.includes(key));
  };

  const reset = () => {
    setActiveId(null);
    setDragColumns(null);
  };

  useDndMonitor({
    onDragStart: ({ active }) => {
      const data = dragData(active);
      if (data?.type !== "task" || !byId.has(data.task.id)) return;
      setActiveId(data.task.id);
      setDragColumns(derived);
    },
    onDragOver: ({ active, over }) => {
      if (!over) return;
      setDragColumns((cols) => {
        if (!cols) return cols;
        const from = containerOf(cols, active);
        const to = containerOf(cols, over);
        if (from === undefined || to === undefined || from === to) return cols;
        const target = cols[to]!;
        const overIndex = target.indexOf(String(over.id));
        const index = overIndex === -1 ? target.length : overIndex;
        return {
          ...cols,
          [from]: cols[from]!.filter((id) => id !== active.id),
          [to]: [...target.slice(0, index), String(active.id), ...target.slice(index)],
        };
      });
    },
    onDragEnd: ({ active, over }) => {
      const cols = dragColumns;
      reset();
      const task = byId.get(String(active.id));
      // Drops on the sidebar are the sidebar's business.
      if (!cols || !over || !task || dropData(over)?.list !== undefined) return;
      const status = containerOf(cols, active);
      if (status === undefined) return;
      let column = cols[status]!;
      const overIndex = column.indexOf(String(over.id));
      const activeIndex = column.indexOf(task.id);
      if (overIndex !== -1 && overIndex !== activeIndex)
        column = arrayMove(column, activeIndex, overIndex);

      const index = column.indexOf(task.id);
      const unchanged = status === task.status && derived[status]!.indexOf(task.id) === index;
      if (unchanged) return;
      const others = column.filter((id) => id !== task.id).flatMap((id) => byId.get(id) ?? []);
      const place = neighbours(others, index, task.list);
      // Reordering next to tasks from other lists has no meaning on disk; let it snap back.
      if (status === task.status && Object.keys(place).length === 0) return;
      move.mutate({
        id: task.id,
        move: { ...(status !== task.status ? { status } : {}), ...place },
      });
    },
    onDragCancel: reset,
  });

  return { columns: dragColumns ?? derived, byId, activeId };
}
