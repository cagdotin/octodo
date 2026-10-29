import {
  useDndMonitor,
  useDraggable,
  useDroppable,
  type Active,
  type ClientRect,
  type Over,
} from "@dnd-kit/core";
import type { List, MoveListInput, WorkspaceSnapshot } from "@octodo/contract";
import {
  inSubtree,
  listDepth,
  listMoveError,
  MAX_LIST_DEPTH,
  movedListId,
} from "@octodo/contract/rules";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode, type ReactElement } from "react";
import { dragData, dropData, type DragData, type DropData } from "@/components/drag-and-drop";
import {
  DeleteListDialog,
  ListNameInput,
  NewListDialog,
  useFollowList,
  type ListEdit,
} from "@/components/list-editing";
import { Section } from "@/components/sidebar-chrome";
import { ListGlyph } from "@/components/task-bits";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
import {
  ChevronRightIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import {
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@octodo/ui/components/sidebar";
import { useCreateList, useMoveList, useMoveTask, useRenameList } from "@/lib/api";
import { foldedLists, type FoldedLists } from "@/lib/prefs";
import { cn } from "@octodo/ui/lib/utils";
import { applyListMove, listTree, type ListNode } from "@/lib/tasks";

/** Linear-sized nav rows: 28px tall, 13px text. */
export const ITEM =
  "h-7 gap-2.5 px-2 pe-9 text-[13px] text-sidebar-foreground/90 data-active:text-sidebar-accent-foreground";

/** A row's task count, at its end; `ITEM` leaves room for it so a long name truncates first. */
export const COUNT = "top-1! font-normal text-xs text-sidebar-foreground/50 tabular-nums";

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
  folded: (id: string) => boolean,
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
  const firstChild = folded(over) ? undefined : lists.find((list) => list.parent === over);
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

/** Where a row's icon starts at `depth`, in pixels: top-level icons line up with the views above. */
const inset = (depth: number) => 8 + depth * 16;

/**
 * The workspace's folded lists, kept per browser. A list that moves or is renamed keeps its state
 * through `rename`; a deleted one is forgotten, and each save drops lists that are gone.
 */
const useFolded = (workspace: string, lists: ReadonlyArray<List>) => {
  const stored = foldedLists(workspace);
  const [folded, setFolded] = useState<FoldedLists>(stored.get);
  const save = (next: FoldedLists) => {
    stored.set(next);
    setFolded(next);
  };
  const exists = (id: string) => lists.some((list) => list.id === id);
  const prune = (ids: ReadonlyArray<string>) => ids.filter(exists);
  return {
    section: folded.section,
    setSection: (section: boolean) => save({ section, lists: prune(folded.lists) }),
    isFolded: (id: string) => folded.lists.includes(id),
    toggle: (id: string) =>
      save({
        ...folded,
        lists: prune(
          folded.lists.includes(id)
            ? folded.lists.filter((known) => known !== id)
            : [...folded.lists, id],
        ),
      }),
    unfold: (id: string) =>
      save({ ...folded, lists: prune(folded.lists.filter((known) => known !== id)) }),
    forget: (id: string) =>
      save({ ...folded, lists: folded.lists.filter((known) => !inSubtree(known, id)) }),
    // The renamed ids are not in the snapshot yet, so this save keeps every id.
    rename: (from: string, to: string) =>
      save({
        ...folded,
        lists: folded.lists.map((id) => (inSubtree(id, from) ? to + id.slice(from.length) : id)),
      }),
  };
};

/**
 * The lists in the sidebar, as a tree in folder order. A list with sublists folds them away. Lists
 * drag onto each other to reorder or nest; tasks dragged from the list or board drop onto a list to
 * move there.
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
  const createList = useCreateList(ws);
  const renameList = useRenameList(ws);
  const navigate = useNavigate();
  const followActive = useFollowList(ws, activeList);
  const folding = useFolded(ws, snapshot.lists);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [edit, setEdit] = useState<ListEdit>(null);
  const done = () => setEdit(null);

  const follow = (from: string, to: string) => {
    folding.rename(from, to);
    followActive(from, to);
  };

  const create = (input: { readonly name: string; readonly parent: string | null }) => {
    done();
    if (input.parent !== null) folding.unfold(input.parent);
    createList.mutate(input, {
      onSuccess: (list) =>
        void navigate({
          to: "/w/$workspace",
          params: { workspace: ws },
          search: (prev) => ({ ...prev, list: list.id, task: undefined }),
        }),
    });
  };

  const rename = (list: List) => (name: string) => {
    done();
    renameList.mutate(
      { id: list.id, name },
      { onSuccess: (renamed) => follow(list.id, renamed.id) },
    );
  };

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
        folding.isFolded,
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
      const placed = placement;
      setPlacement(null);
      if (data?.type === "task") {
        const list = dropData(over)?.list;
        if (list !== undefined && list !== data.task.list) {
          moveTask.mutate({ id: data.task.id, move: { list } });
        }
        return;
      }
      if (data?.type !== "list" || placed === null) return;
      const id = data.list.id;
      if (sameOrder(applyListMove(snapshot, id, placed.move).lists, snapshot.lists)) return;
      moveList.mutate({ id, move: placed.move });
      const parent = placed.move.parent === undefined ? data.list.parent : placed.move.parent;
      follow(id, movedListId(id, parent));
    },
    onDragCancel: () => setPlacement(null),
  });

  const rows = (node: ListNode, depth: number): Array<ReactNode> => {
    const { list, children } = node;
    const folded = children.length === 0 ? null : folding.isFolded(list.id);
    return [
      <ListRow
        key={list.id}
        workspace={ws}
        list={list}
        depth={depth}
        count={counts.get(list.id) ?? 0}
        active={activeList === list.id}
        placement={placement?.over === list.id ? placement.zone : null}
        folded={folded}
        onToggle={() => folding.toggle(list.id)}
        onNavigate={onNavigate}
        onEdit={setEdit}
        renaming={
          edit?.kind === "rename" && edit.list.id === list.id ? (
            <ListNameInput
              lists={snapshot.lists}
              list={list}
              inset={inset(depth)}
              onSubmit={rename(list)}
              onCancel={done}
            />
          ) : null
        }
      />,
      ...(folded === true ? [] : children.flatMap((child) => rows(child, depth + 1))),
    ];
  };

  const newList = (parent: string | null) => () => setEdit({ kind: "create", parent });
  return (
    <Section
      label="Lists"
      open={!folding.section}
      onOpenChange={(open) => folding.setSection(!open)}
      action={{ label: "New list", icon: <PlusIcon />, onClick: newList(null) }}
    >
      {listTree(snapshot.lists).flatMap((node) => rows(node, 0))}
      <NewListDialog
        key={edit?.kind === "create" ? `create:${edit.parent}` : "create"}
        lists={snapshot.lists}
        parent={edit?.kind === "create" ? edit.parent : null}
        open={edit?.kind === "create"}
        onCreate={create}
        onClose={done}
      />
      <DeleteListDialog
        key={edit?.kind === "delete" ? edit.list.id : "delete"}
        snapshot={snapshot}
        list={edit?.kind === "delete" ? edit.list : null}
        onDeleted={(id) => {
          folding.forget(id);
          followActive(id, undefined);
        }}
        onClose={done}
      />
    </Section>
  );
}

/** A folding list's icon hides under its chevron while the row is hovered. */
const TOGGLE_HIDES =
  "md:group-hover/list-row:opacity-0 md:group-has-focus-visible/list-row:opacity-0";

function ListRow({
  workspace,
  list,
  depth,
  count,
  active,
  placement,
  folded,
  onToggle,
  onNavigate,
  onEdit,
  renaming,
}: {
  workspace: string;
  list: List;
  depth: number;
  count: number;
  active: boolean;
  placement: Placement["zone"] | null;
  /** Whether its sublists are folded away; null for a list without sublists. */
  folded: boolean | null;
  onToggle: () => void;
  onNavigate: () => void;
  onEdit: (edit: ListEdit) => void;
  /** The name field that takes the row's place while the list is renamed. */
  renaming: ReactNode;
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
      style={{ paddingInlineStart: inset(depth) }}
      className={cn(
        drag.isDragging && "opacity-40",
        (placement === "inside" || taskOver) && "bg-sidebar-accent ring-1 ring-sidebar-ring",
      )}
      {...drag.attributes}
      {...drag.listeners}
    >
      {folded === false ? (
        <FolderOpenIcon className={TOGGLE_HIDES} />
      ) : (
        <ListGlyph className={cn(folded === true && TOGGLE_HIDES)} />
      )}
      <span>{list.name}</span>
      {folded === true && (
        <ChevronRightIcon
          aria-hidden
          className="-ms-1.5 size-3! shrink-0 text-sidebar-foreground/40"
        />
      )}
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

  const actions = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuAction
            aria-label={`Actions for ${list.name}`}
            className="top-1! text-sidebar-foreground/70 group-hover/list-row:opacity-100 group-has-focus-visible/list-row:opacity-100 data-popup-open:opacity-100 md:opacity-0"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right">
        <DropdownMenuItem
          onClick={() =>
            onEdit({
              kind: "create",
              parent: listDepth(list.id) < MAX_LIST_DEPTH ? list.id : list.parent,
            })
          }
        >
          <PlusIcon />
          New list
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onEdit({ kind: "rename", list })}>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onEdit({ kind: "delete", list })}>
          <TrashIcon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The row's count gives way to the actions button, which phones without hover always show.
  return (
    <SidebarMenuItem>
      {renaming ?? (
        <div className="group/list-row relative">
          <SidebarMenuButton isActive={active} className={ITEM} render={link as ReactElement} />
          {Array.from({ length: depth }, (_, level) => (
            <span
              key={level}
              aria-hidden
              style={{ left: inset(level) + 7.5 }}
              className="pointer-events-none absolute -top-px -bottom-px w-px bg-sidebar-border"
            />
          ))}
          {folded !== null && (
            <button
              type="button"
              aria-label={`${folded ? "Show" : "Hide"} the sublists of ${list.name}`}
              aria-expanded={!folded}
              onClick={onToggle}
              style={{ left: inset(depth) }}
              className="absolute top-1.5 flex size-4 items-center justify-center rounded-sm text-sidebar-foreground/70 opacity-0 outline-hidden group-hover/list-row:opacity-100 hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring max-md:hidden"
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", !folded && "rotate-90")}
              />
            </button>
          )}
          {count > 0 && (
            <SidebarMenuBadge
              className={cn(
                COUNT,
                "max-md:hidden group-hover/list-row:opacity-0 group-has-focus-visible/list-row:opacity-0 group-has-data-popup-open/list-row:opacity-0",
              )}
            >
              {count}
            </SidebarMenuBadge>
          )}
          {actions}
          {line}
        </div>
      )}
    </SidebarMenuItem>
  );
}
