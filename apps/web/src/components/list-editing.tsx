import type { List, WorkspaceSnapshot } from "@octodo/contract";
import { inSubtree, listDepth, MAX_LIST_DEPTH } from "@octodo/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  DialogPanel,
  DialogTitle,
} from "@octodo/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@octodo/ui/components/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@octodo/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@octodo/ui/components/select";
import { Label } from "@octodo/ui/components/label";
import { cn } from "@octodo/ui/lib/utils";
import { ListGlyph } from "@/components/task-bits";
import { useDeleteList } from "@/lib/api";
import { listLabel, listNameError, tasksInList } from "@/lib/tasks";

/** What the sidebar is doing to its lists: a new one to name, a rename in place, or a delete to confirm. */
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

/** A list's new name typed in place of its row. Enter or leaving the field saves; Escape cancels. */
export function ListNameInput({
  lists,
  list,
  inset,
  onSubmit,
  onCancel,
}: {
  lists: ReadonlyArray<List>;
  list: List;
  /** Where the row's icon starts, in pixels, so the field lines up with the row it replaces. */
  inset: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(list.name);
  const finished = useRef(false);
  const trimmed = name.trim();
  const error = trimmed === "" ? null : listNameError(lists, list.parent, trimmed, list.id);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save && trimmed !== "" && trimmed !== list.name && error === null) onSubmit(trimmed);
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
        style={{ paddingInlineStart: inset }}
        className={cn(
          "flex h-7 items-center gap-2.5 rounded-md bg-sidebar-accent pe-2 ring-1 ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground/70",
          error !== null && "ring-destructive",
        )}
      >
        <ListGlyph />
        {/* The field appears because the person asked to name a list, so it takes the focus. */}
        {/* react-doctor-disable-next-line react-doctor/no-autofocus */}
        <input
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          aria-label="List name"
          aria-invalid={error !== null || undefined}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-accent-foreground outline-none"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(error === null)}
        />
      </div>
      {error !== null && (
        <p
          className="pt-1 pe-2 text-xs text-destructive-foreground"
          style={{ paddingInlineStart: inset }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

const TOP_LEVEL = "__top__";

/** Names a new list and picks the list it goes in, the one it was opened from preselected. */
export function NewListDialog({
  lists,
  parent: initialParent,
  open,
  onCreate,
  onClose,
}: {
  lists: ReadonlyArray<List>;
  parent: string | null;
  open: boolean;
  onCreate: (list: { readonly name: string; readonly parent: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(initialParent ?? TOP_LEVEL);
  const parentId = parent === TOP_LEVEL ? null : parent;
  const trimmed = name.trim();
  const error = trimmed === "" ? null : listNameError(lists, parentId, trimmed);
  const parents = [
    { value: TOP_LEVEL, label: "None" },
    ...lists
      .filter((list) => listDepth(list.id) < MAX_LIST_DEPTH)
      .map((list) => ({ value: list.id, label: listLabel(lists, list.id) })),
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === "" || error !== null) return;
    onCreate({ name: trimmed, parent: parentId });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{parentId === null ? "New list" : "New sublist"}</DialogTitle>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-5">
            <Field invalid={error !== null}>
              <FieldLabel htmlFor="new-list-name">Name</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <ListGlyph />
                </InputGroupAddon>
                <InputGroupInput
                  id="new-list-name"
                  autoFocus
                  placeholder="Groceries"
                  value={name}
                  aria-invalid={error !== null || undefined}
                  onChange={(event) => setName(event.target.value)}
                />
              </InputGroup>
              {error !== null && <FieldError match>{error}</FieldError>}
            </Field>
            <Field>
              <FieldLabel>Inside</FieldLabel>
              <Select
                items={parents}
                value={parent}
                onValueChange={(value) => value !== null && setParent(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {parents.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>Lists nest up to {MAX_LIST_DEPTH} levels deep.</FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed === "" || error !== null}>
              Create list
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** What deleting a list does to its sublists and tasks, in the dialog's words. */
const deleteListSummary = (sublists: number, tasks: number, deleteTasks: boolean) => {
  const lists =
    sublists === 0
      ? "This deletes the list."
      : `This deletes the list and its ${sublists === 1 ? "sublist" : plural(sublists, "sublist")}.`;
  if (tasks === 0) return `${lists} It has no tasks.`;
  if (deleteTasks)
    return `${lists} ${tasks === 1 ? "Its task is" : `Its ${tasks} tasks are`} deleted too.`;
  return tasks === 1
    ? `${lists} Its task moves to No list, whatever its status.`
    : `${lists} Its ${tasks} tasks move to No list, whatever their status.`;
};

const sublistCount = (lists: ReadonlyArray<List>, list: List) =>
  lists.filter((other) => other.id !== list.id && inSubtree(other.id, list.id)).length;

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
  const sublists = list === null ? 0 : sublistCount(snapshot.lists, list);

  return (
    <AlertDialog open={list !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {list?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteListSummary(sublists, tasks.length, deleteTasks)}
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
