import type { List } from "@octodo/contract";
import { listDepth, MAX_LIST_DEPTH } from "@octodo/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@octodo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@octodo/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@octodo/ui/components/field";
import { Input } from "@octodo/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@octodo/ui/components/select";
import { Spinner } from "@octodo/ui/components/spinner";
import { useCreateList } from "@/lib/api";
import { listLabel } from "@/lib/tasks";

const TOP_LEVEL = "__top__";

export function NewListDialog({
  workspace,
  lists,
  open,
  onOpenChange,
}: {
  workspace: string;
  lists: ReadonlyArray<List>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(TOP_LEVEL);
  const create = useCreateList(workspace);
  const navigate = useNavigate();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), parent: parent === TOP_LEVEL ? null : parent },
      {
        onSuccess: (list) => {
          onOpenChange(false);
          setName("");
          setParent(TOP_LEVEL);
          void navigate({
            to: "/w/$workspace",
            params: { workspace },
            search: (prev) => ({ ...prev, list: list.id, task: undefined }),
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New list</DialogTitle>
            <DialogDescription>
              Lists are folders under .octodo/tasks/ and nest up to {MAX_LIST_DEPTH} levels deep.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={create.isError || undefined}>
              <FieldLabel htmlFor="list-name">Name</FieldLabel>
              <Input
                id="list-name"
                autoFocus
                required
                value={name}
                aria-invalid={create.isError || undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {create.isError && <FieldError>{create.error.message}</FieldError>}
              <FieldDescription>
                New lists go last; drag them in the sidebar to reorder.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Inside</FieldLabel>
              <Select value={parent} onValueChange={setParent}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={TOP_LEVEL}>Top level</SelectItem>
                    {lists
                      .filter((list) => listDepth(list.id) < MAX_LIST_DEPTH)
                      .map((list) => (
                        <SelectItem key={list.id} value={list.id}>
                          {listLabel(lists, list.id)}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              {create.isPending && <Spinner data-icon="inline-start" />}
              Create list
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
