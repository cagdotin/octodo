import {
  useDndMonitor,
  useDraggable,
  useDroppable,
  type Active,
  type ClientRect,
  type Over,
} from "@dnd-kit/core";
import type { List, MoveListInput, WorkspaceSnapshot } from "@octodo/contract";
import { inSubtree, listMoveError, movedListId } from "@octodo/contract/rules";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { dragData, dropData, type DragData, type DropData } from "@/components/drag-and-drop";
import { ListGlyph } from "@/components/task-bits";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useMoveList, useMoveTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { applyListMove, listTree, type ListNode } from "@/lib/tasks";

/** Linear-sized nav rows: 28px tall, 13px text. */
export const ITEM =
  "h-7 gap-2.5 px-2 font-mono text-[12.5px] text-sidebar-foreground/90 data-active:text-sidebar-accent-foreground";

const LIST_PREFIX = "list:";

/** Where a dragged list would land: a line above or below a row, or inside it. */
interface Placement {
  readonly over: string;
  readonly zone: "before" | "after" | "inside";
  readonly move: MoveListInput;
}

/** The pointer's height on screen: where the drag started plus how far it has gone. */
const pointerY = (activatorEvent: Event, deltaY: number): number | undefined => {
  if (activatorEvent instanceof MouseEvent) return activatorEvent.clientY + deltaY;
  if (typeof TouchEvent !== "undefined" && activatorEvent instanceof TouchEvent) {
    const touch = activatorEvent.touches[0];
    return touch === undefined ? undefined : touch.clientY + deltaY;
  }
  return undefined;
};

/**
 * The top and bottom thirds of a row put the dragged list next to it; the middle nests it inside.
 * Below a row whose sublists show beneath it, "after" means first among those sublists, which is
 * where the line is drawn. Spots the server would refuse (too deep, a list inside itself, a
 * second list with the same name) give no placement.
 */
const placementFor = (
  lists: ReadonlyArray<List>,
  dragged: string,
  over: string,
  rect: ClientRect,
  y: number | undefined,
): Placement | null => {
  if (inSubtree(over, dragged)) return null;
  const fits = (parent: string | null) => listMoveError(lists, dragged, parent) === null;
  const target = lists.find((list) => list.id === over);
  if (!target) return null;
  const ratio = y === undefined ? 0.5 : (y - rect.top) / rect.height;
  const firstChild = lists.find((list) => list.parent === over);
  if (ratio < 1 / 3) {
    return fits(target.parent)
      ? { over, zone: "before", move: { parent: target.parent, before: over } }
      : null;
  }
  if (ratio > 2 / 3) {
    if (firstChild) {
      return fits(over)
        ? { over, zone: "after", move: { parent: over, before: firstChild.id } }
        : null;
    }
    return fits(target.parent)
      ? { over, zone: "after", move: { parent: target.parent, after: over } }
      : null;
  }
  return fits(over) ? { over, zone: "inside", move: { parent: over } } : null;
};

const sameOrder = (a: ReadonlyArray<List>, b: ReadonlyArray<List>) =>
  a.length === b.length && a.every((list, index) => list.id === b[index]?.id);

/**
 * The lists in the sidebar, as a tree in folder order. Lists drag onto each other to reorder or
 * nest; tasks dragged from the list or board drop onto a list to move there.
 */
export function SidebarLists({
  snapshot,
  activeList,
  counts,
  onNavigate,
}: {
  snapshot: WorkspaceSnapshot;
  activeList: string | undefined;
  counts: ReadonlyMap<string, number>;
  onNavigate: () => void;
}) {
  const ws = snapshot.workspace.id;
  const moveList = useMoveList(ws);
  const moveTask = useMoveTask(ws);
  const navigate = useNavigate();
  const [placement, setPlacement] = useState<Placement | null>(null);

  const listOver = (over: Over | null) => {
    const list = dropData(over)?.list;
    return list === undefined || list === null ? undefined : list;
  };

  const track = (active: Active, over: Over | null, activatorEvent: Event, deltaY: number) => {
    const data = dragData(active);
    const target = listOver(over);
    if (data?.type !== "list" || over === null || target === undefined) {
      setPlacement(null);
      return;
    }
    setPlacement(
      placementFor(
        snapshot.lists,
        data.list.id,
        target,
        over.rect,
        pointerY(activatorEvent, deltaY),
      ),
    );
  };

  useDndMonitor({
    onDragMove: ({ active, over, activatorEvent, delta }) =>
      track(active, over, activatorEvent, delta.y),
    onDragOver: ({ active, over, activatorEvent, delta }) =>
      track(active, over, activatorEvent, delta.y),
    onDragEnd: ({ active, over }) => {
      const data = dragData(active);
      const done = placement;
      setPlacement(null);
      if (data?.type === "task") {
        const list = dropData(over)?.list;
        if (list !== undefined && list !== data.task.list) {
          moveTask.mutate({ id: data.task.id, move: { list } });
        }
        return;
      }
      if (data?.type !== "list" || done === null) return;
      const id = data.list.id;
      if (sameOrder(applyListMove(snapshot, id, done.move).lists, snapshot.lists)) return;
      moveList.mutate({ id, move: done.move });
      // A list that changes parent changes id; keep showing it (or the sublist being shown).
      const parent = done.move.parent === undefined ? data.list.parent : done.move.parent;
      const renamed = movedListId(id, parent);
      if (renamed !== id && activeList !== undefined && inSubtree(activeList, id)) {
        void navigate({
          to: "/w/$workspace",
          params: { workspace: ws },
          search: (prev) => ({ ...prev, list: renamed + activeList.slice(id.length) }),
        });
      }
    },
    onDragCancel: () => setPlacement(null),
  });

  const render = (node: ListNode, depth: number): ReactNode => (
    <ListRow
      key={node.list.id}
      workspace={ws}
      list={node.list}
      depth={depth}
      count={counts.get(node.list.id) ?? 0}
      active={activeList === node.list.id}
      placement={placement?.over === node.list.id ? placement.zone : null}
      onNavigate={onNavigate}
    >
      {node.children.length > 0 ? (
        <SidebarMenuSub>{node.children.map((child) => render(child, depth + 1))}</SidebarMenuSub>
      ) : null}
    </ListRow>
  );

  return <>{listTree(snapshot.lists).map((node) => render(node, 0))}</>;
}

function ListRow({
  workspace,
  list,
  depth,
  count,
  active,
  placement,
  onNavigate,
  children,
}: {
  workspace: string;
  list: List;
  depth: number;
  count: number;
  active: boolean;
  placement: Placement["zone"] | null;
  onNavigate: () => void;
  children: ReactNode;
}) {
  const drag = useDraggable({
    id: `drag-${LIST_PREFIX}${list.id}`,
    data: {
      type: "list",
      list,
      overlay: () => (
        <div className="flex h-7 w-fit items-center gap-2 rounded-md border bg-sidebar px-2 text-sm text-sidebar-foreground shadow-lg [&>svg]:size-4 [&>svg]:text-sidebar-foreground/70">
          <ListGlyph />
          <span>{list.name}</span>
        </div>
      ),
      atPointer: true,
    } satisfies DragData,
  });
  const drop = useDroppable({
    id: `${LIST_PREFIX}${list.id}`,
    data: { accepts: ["list", "task"], list: list.id, pointerOnly: ["task"] } satisfies DropData,
  });
  const taskOver = drop.isOver && dragData(drop.active)?.type === "task";

  const link = (
    <Link
      ref={(node: HTMLAnchorElement | null) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      to="/w/$workspace"
      params={{ workspace }}
      search={(prev) => ({ ...prev, list: list.id, task: undefined })}
      onClick={onNavigate}
      draggable={false}
      className={cn(
        drag.isDragging && "opacity-40",
        (placement === "inside" || taskOver) && "bg-sidebar-accent ring-1 ring-sidebar-ring",
      )}
      {...drag.attributes}
      {...drag.listeners}
    >
      <ListGlyph />
      <span>{list.name}</span>
    </Link>
  );
  // The drop line sits in the gap between rows, so it does not shift anything.
  const line =
    placement === "before" || placement === "after" ? (
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-sidebar-primary",
          placement === "before" ? "top-0 -translate-y-1/2" : "top-7 -translate-y-1/2",
        )}
      />
    ) : null;

  if (depth === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} className={ITEM}>
          {link}
        </SidebarMenuButton>
        {count > 0 && (
          <SidebarMenuBadge className="top-1! font-normal text-sidebar-foreground/50">
            {count}
          </SidebarMenuBadge>
        )}
        {line}
        {children}
      </SidebarMenuItem>
    );
  }
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        asChild
        isActive={active}
        className="h-7 text-sidebar-foreground/90 [&>svg]:text-sidebar-foreground/70"
      >
        {link}
      </SidebarMenuSubButton>
      {count > 0 && (
        <span className="pointer-events-none absolute top-1.5 right-2 font-mono text-xs text-sidebar-foreground/50">
          {count}
        </span>
      )}
      {line}
      {children}
    </SidebarMenuSubItem>
  );
}
