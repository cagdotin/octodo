import type { List, WorkspaceSnapshot } from "@octodo/contract";
import { inSubtree } from "@octodo/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@octodo/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@octodo/ui/components/field";
import { Input } from "@octodo/ui/components/input";
import { Label } from "@octodo/ui/components/label";
import { Spinner } from "@octodo/ui/components/spinner";
import { useDeleteList, useRenameList } from "@/lib/api";
import { tasksInList } from "@/lib/tasks";

/** Which list dialog is open, if any. */
export type ListEdit = { readonly kind: "rename" | "delete"; readonly list: List } | null;

/** Keeps the page on the list being shown, or its sublist, when the list's id changes or it goes. */
const useFollowList = (workspace: string, activeList: string | undefined) => {
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

export function ListDialogs({
  snapshot,
  edit,
  activeList,
  onClose,
}: {
  snapshot: WorkspaceSnapshot;
  edit: ListEdit;
  activeList: string | undefined;
  onClose: () => void;
}) {
  const workspace = snapshot.workspace.id;
  const follow = useFollowList(workspace, activeList);
  return (
    <>
      <RenameListDialog
        key={edit?.kind === "rename" ? edit.list.id : "rename"}
        workspace={workspace}
        list={edit?.kind === "rename" ? edit.list : null}
        onRenamed={follow}
        onClose={onClose}
      />
      <DeleteListDialog
        key={edit?.kind === "delete" ? edit.list.id : "delete"}
        snapshot={snapshot}
        list={edit?.kind === "delete" ? edit.list : null}
        onDeleted={(id) => follow(id, undefined)}
        onClose={onClose}
      />
    </>
  );
}

function RenameListDialog({
  workspace,
  list,
  onRenamed,
  onClose,
}: {
  workspace: string;
  list: List | null;
  onRenamed: (from: string, to: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(list?.name ?? "");
  const rename = useRenameList(workspace);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (list === null) return;
    if (name.trim() === list.name) return onClose();
    rename.mutate(
      { id: list.id, name: name.trim() },
      {
        onSuccess: (renamed) => {
          onRenamed(list.id, renamed.id);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={list !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Rename list</DialogTitle>
          </DialogHeader>
          <Field data-invalid={rename.isError || undefined}>
            <FieldLabel htmlFor="rename-list">Name</FieldLabel>
            <Input
              id="rename-list"
              autoFocus
              required
              value={name}
              aria-invalid={rename.isError || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {rename.isError && <FieldError>{rename.error.message}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={rename.isPending || name.trim() === ""}>
              {rename.isPending && <Spinner data-icon="inline-start" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function DeleteListDialog({
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
            {sublists > 0
              ? `This deletes the list and its ${sublists === 1 ? "sublist" : plural(sublists, "sublist")}. `
              : "This deletes the list. "}
            {tasks.length === 0
              ? "It has no tasks."
              : deleteTasks
                ? `${tasks.length === 1 ? "Its task is" : `Its ${tasks.length} tasks are`} deleted too.`
                : `${tasks.length === 1 ? "Its task moves" : `Its ${tasks.length} tasks move`} to No list, whatever their status.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {tasks.length > 0 && (
          <Label htmlFor={checkboxId} className="px-6 pb-5 font-normal">
            <Checkbox
              id={checkboxId}
              checked={deleteTasks}
              onCheckedChange={(checked) => setDeleteTasks(checked)}
            />
            Also delete {tasks.length === 1 ? "its task" : `all ${tasks.length} tasks`}
          </Label>
        )}
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
