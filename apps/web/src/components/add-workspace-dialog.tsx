import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useAddWorkspace } from "@/lib/api";

const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/;

interface Props {
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AddWorkspaceDialog({ trigger, open, onOpenChange }: Props) {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [root, setRoot] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const add = useAddWorkspace();
  const navigate = useNavigate();
  const error = pathError ?? (add.isError ? add.error.message : null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The server resolves relative paths against its own working directory, which is never what you want.
    if (!ABSOLUTE.test(root.trim())) {
      setPathError("Use an absolute path, e.g. /Users/me/code/project");
      return;
    }
    setPathError(null);
    add.mutate(
      {
        root: root.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(key.trim() ? { key: key.trim().toUpperCase() } : {}),
      },
      {
        onSuccess: (workspace) => {
          setOpen(false);
          setRoot("");
          setName("");
          setKey("");
          void navigate({ to: "/w/$workspace", params: { workspace: workspace.id } });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Point tasksmd at a folder. It creates <code>.tasks/</code> there if it doesn't exist
              yet.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="ws-root">Folder</FieldLabel>
              <Input
                id="ws-root"
                placeholder="/Users/me/code/project"
                className="font-mono"
                required
                autoFocus
                value={root}
                aria-invalid={error !== null || undefined}
                onChange={(event) => {
                  setRoot(event.target.value);
                  setPathError(null);
                }}
              />
              <FieldDescription>Absolute path on the machine running tasksmd.</FieldDescription>
              {error !== null && <FieldError>{error}</FieldError>}
            </Field>
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <Field>
                <FieldLabel htmlFor="ws-name">Name</FieldLabel>
                <Input
                  id="ws-name"
                  placeholder="Folder name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ws-key">Key</FieldLabel>
                <Input
                  id="ws-key"
                  placeholder="ABC"
                  className="font-mono uppercase"
                  maxLength={8}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || root.trim() === ""}>
              {add.isPending && <Spinner data-icon="inline-start" />}
              Add workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
