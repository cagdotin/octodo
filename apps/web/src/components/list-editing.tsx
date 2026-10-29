import type { List, WorkspaceSnapshot } from "@octodo/contract";
import { inSubtree } from "@octodo/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@octodo/ui/components/alert-dialog";
import { Button } from "@octodo/ui/components/button";
import { Checkbox } from "@octodo/ui/components/checkbox";
import { Label } from "@octodo/ui/components/label";
import { cn } from "@octodo/ui/lib/utils";
import { ListGlyph } from "@/components/task-bits";
import { useDeleteList } from "@/lib/api";
import { listNameError, tasksInList } from "@/lib/tasks";

/** What the sidebar is doing to its lists: a name typed in place, or a delete to confirm. */
export type ListEdit =
  | { readonly kind: "create"; readonly parent: string | null }
  | { readonly kind: "rename"; readonly list: List }
  | { readonly kind: "delete"; readonly list: List }
  | null;

/** Keeps the page on the list being shown, or its sublist, when the list's id changes or it goes. */
export const useFollowList = (workspace: string, activeList: string | undefined) => {
  const navigate = useNavigate();
  return (from: string, to: string | undefined) => {
    if (activeList === undefined || !inSubtree(activeList, from)) return;
    void navigate({
      to: "/w/$workspace",
      params: { workspace },
      search: (prev) => ({
        ...prev,
        list: to === undefined ? undefined : to + activeList.slice(from.length),
      }),
    });
  };
};

/**
 * A list's name typed in place of its sidebar row. Enter saves, Escape cancels, and leaving the
 * field saves what was typed or cancels when it is empty or unchanged.
 */
export function ListNameInput({
  lists,
  parent,
  list,
  sub,
  onSubmit,
  onCancel,
}: {
  lists: ReadonlyArray<List>;
  parent: string | null;
  /** The list being renamed; none when creating one. */
  list?: List;
  sub: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const finished = useRef(false);
  const trimmed = name.trim();
  const error = trimmed === "" ? null : listNameError(lists, parent, trimmed, list?.id);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save && trimmed !== "" && trimmed !== list?.name && error === null) onSubmit(trimmed);
    else onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && error === null) {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={cn(
          "flex h-7 items-center gap-2.5 rounded-md bg-sidebar-accent px-2 ring-1 ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground/70",
          error !== null && "ring-destructive",
        )}
      >
        <ListGlyph />
        <input
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          aria-label={
            list === undefined ? (sub ? "New sublist name" : "New list name") : "List name"
          }
          aria-invalid={error !== null || undefined}
          placeholder={sub ? "Sublist name" : "List name"}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-accent-foreground outline-none placeholder:text-sidebar-foreground/40"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(error === null)}
        />
      </div>
      {error !== null && <p className="px-2 pt-1 text-xs text-destructive-foreground">{error}</p>}
    </div>
  );
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

export function DeleteListDialog({
  snapshot,
  list,
  onDeleted,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  list: List | null;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [deleteTasks, setDeleteTasks] = useState(false);
  const remove = useDeleteList(snapshot.workspace.id);
  const checkboxId = useId();
  const tasks = list === null ? [] : tasksInList(snapshot.tasks, list.id);
  const sublists =
    list === null
      ? 0
      : snapshot.lists.filter((other) => other.id !== list.id && inSubtree(other.id, list.id))
          .length;

  return (
    <AlertDialog open={list !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {list?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {sublists === 0
              ? "This deletes the list. "
              : `This deletes the list and its ${sublists === 1 ? "sublist" : plural(sublists, "sublist")}. `}
            {tasks.length === 0
              ? "It has no tasks."
              : deleteTasks
                ? `${tasks.length === 1 ? "Its task is" : `Its ${tasks.length} tasks are`} deleted too.`
                : tasks.length === 1
                  ? "Its task moves to No list, whatever its status."
                  : `Its ${tasks.length} tasks move to No list, whatever their status.`}
          </AlertDialogDescription>
          {tasks.length > 0 && (
            <Label htmlFor={checkboxId} className="mt-2 font-normal">
              <Checkbox
                id={checkboxId}
                checked={deleteTasks}
                onCheckedChange={(checked) => setDeleteTasks(checked)}
              />
              Also delete {tasks.length === 1 ? "its task" : `all ${tasks.length} tasks`}
            </Label>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose
            render={<Button variant="destructive" />}
            onClick={() => {
              if (list === null) return;
              remove.mutate({ id: list.id, deleteTasks });
              onDeleted(list.id);
            }}
          >
            {deleteTasks && tasks.length > 0 ? "Delete list and tasks" : "Delete list"}
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
