import { DEFAULT_PRESET, PRESET_IDS, PRESETS, type PresetId } from "@octodo/contract/presets";
import { deriveKey, humanize } from "@octodo/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderCheckIcon,
} from "lucide-react";
import { useState, type FormEvent, type ReactElement } from "react";
import { Badge } from "@octodo/ui/components/badge";
import { Button } from "@octodo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "@octodo/ui/components/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@octodo/ui/components/field";
import { Label } from "@octodo/ui/components/label";
import { Fieldset, FieldsetLegend } from "@octodo/ui/components/fieldset";
import { Input } from "@octodo/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@octodo/ui/components/input-group";
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from "@octodo/ui/components/item";
import { RadioGroup, RadioGroupItem } from "@octodo/ui/components/radio-group";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { Skeleton } from "@octodo/ui/components/skeleton";
import { Spinner } from "@octodo/ui/components/spinner";
import { foldersQuery, useAddWorkspace } from "@/lib/api";
import { desktop } from "@/lib/desktop";

const ABSOLUTE = /^(\/|[A-Za-z]:[\\/])/;

const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? "";

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
  const [preset, setPreset] = useState<PresetId>(DEFAULT_PRESET);
  const [browsing, setBrowsing] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const add = useAddWorkspace();
  const navigate = useNavigate();
  const error = pathError ?? (add.isError ? add.error.message : null);

  const trimmed = root.trim();
  const absolute = ABSOLUTE.test(trimmed);
  // Whether the folder already holds a workspace, which then opens as it is.
  const chosen = useQuery({ ...foldersQuery(trimmed), enabled: absolute });
  const existing = absolute && chosen.data?.workspace === true;
  const suggestedName = absolute ? humanize(basename(trimmed)) : "";

  const reset = () => {
    setRoot("");
    setName("");
    setKey("");
    setPreset(DEFAULT_PRESET);
    setBrowsing(false);
    setPathError(null);
    add.reset();
  };

  const choose = (path: string) => {
    setRoot(path);
    setPathError(null);
    setBrowsing(false);
  };

  const pick = async () => {
    if (!desktop) {
      setBrowsing((value) => !value);
      return;
    }
    const path = await desktop.pickFolder(absolute ? trimmed : undefined);
    if (path !== null) choose(path);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The server resolves relative paths against its own working directory, which is never what you want.
    if (!absolute) {
      setPathError("Use an absolute path, e.g. /Users/me/code/project");
      return;
    }
    add.mutate(
      existing ? { root: trimmed } : { root: trimmed, ...newWorkspace(name, key, preset) },
      {
        onSuccess: (workspace) => {
          setOpen(false);
          reset();
          void navigate({ to: "/w/$workspace", params: { workspace: workspace.id } });
        },
      },
    );
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {trigger && <DialogTrigger render={trigger as ReactElement} />}
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>
              Choose a project folder. octodo keeps its tasks in a <code>.octodo/</code> folder
              there, and opens the one that is already there.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-5">
            <FolderField
              root={root}
              onRoot={(next) => {
                setRoot(next);
                setPathError(null);
              }}
              error={error}
              existing={existing}
              browsing={browsing}
              start={absolute ? trimmed : undefined}
              onPick={() => void pick()}
              onChoose={choose}
            />
            {!existing && (
              <NewWorkspaceFields
                name={name}
                onName={setName}
                workspaceKey={key}
                onKey={setKey}
                preset={preset}
                onPreset={setPreset}
                suggestedName={suggestedName}
              />
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || trimmed === ""}>
              {add.isPending && <Spinner data-icon="inline-start" />}
              {existing ? "Open workspace" : "Add workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What a new workspace sends besides its folder: the preset, and the name and key unless empty. */
const newWorkspace = (name: string, key: string, preset: PresetId) => ({
  preset,
  ...(name.trim() ? { name: name.trim() } : {}),
  ...(key.trim() ? { key: key.trim().toUpperCase() } : {}),
});

function FolderField({
  root,
  onRoot,
  error,
  existing,
  browsing,
  start,
  onPick,
  onChoose,
}: {
  root: string;
  onRoot: (root: string) => void;
  error: string | null;
  existing: boolean;
  browsing: boolean;
  start: string | undefined;
  onPick: () => void;
  onChoose: (path: string) => void;
}) {
  return (
    <Field invalid={error !== null}>
      <FieldLabel htmlFor="ws-root">Folder</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="ws-root"
          placeholder="/Users/me/code/project"
          className="font-mono"
          required
          autoFocus
          value={root}
          aria-invalid={error !== null || undefined}
          onChange={(event) => onRoot(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            aria-expanded={desktop ? undefined : browsing}
            onClick={onPick}
          >
            <FolderOpenIcon data-icon="inline-start" />
            Choose…
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {browsing && <FolderBrowser start={start} onChoose={onChoose} />}
      <FolderHint error={error} existing={existing} />
    </Field>
  );
}

function FolderHint({ error, existing }: { error: string | null; existing: boolean }) {
  if (error !== null) return <FieldError match>{error}</FieldError>;
  if (!existing)
    return <FieldDescription>A folder on the machine running octodo.</FieldDescription>;
  return (
    <FieldDescription className="flex items-center gap-1.5">
      <FolderCheckIcon className="size-3.5" />
      Already a octodo workspace; it opens as it is.
    </FieldDescription>
  );
}

function NewWorkspaceFields({
  name,
  onName,
  workspaceKey,
  onKey,
  preset,
  onPreset,
  suggestedName,
}: {
  name: string;
  onName: (name: string) => void;
  workspaceKey: string;
  onKey: (key: string) => void;
  preset: PresetId;
  onPreset: (preset: PresetId) => void;
  suggestedName: string;
}) {
  return (
    <>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field>
          <FieldLabel htmlFor="ws-name">Name</FieldLabel>
          <Input
            id="ws-name"
            placeholder={suggestedName || "Folder name"}
            value={name}
            onChange={(event) => onName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ws-key">Key</FieldLabel>
          <Input
            id="ws-key"
            placeholder={deriveKey(name.trim() || suggestedName || "abc")}
            className="font-mono uppercase"
            maxLength={8}
            value={workspaceKey}
            onChange={(event) => onKey(event.target.value)}
          />
        </Field>
      </div>
      <Fieldset className="gap-2">
        <FieldsetLegend className="text-sm font-medium">Start with</FieldsetLegend>
        <RadioGroup
          value={preset}
          onValueChange={(value) => onPreset(value as PresetId)}
          className="gap-2"
        >
          {PRESET_IDS.map((id) => (
            <Label
              key={id}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50"
            >
              <div className="flex flex-1 flex-col gap-1">
                <span className="font-medium">{PRESETS[id].name}</span>
                <span className="text-xs text-muted-foreground">{PRESETS[id].description}</span>
              </div>
              <RadioGroupItem value={id} />
            </Label>
          ))}
        </RadioGroup>
      </Fieldset>
    </>
  );
}

/**
 * Browses folders on the server's machine, for a browser (or a phone) that has no native picker
 * able to hand over an absolute path. Starts in `start`, or the home folder.
 */
function FolderBrowser({
  start,
  onChoose,
}: {
  start: string | undefined;
  onChoose: (path: string) => void;
}) {
  const [path, setPath] = useState(start);
  const listing = useQuery(foldersQuery(path));
  const current = listing.data;

  return (
    <div className="flex flex-col overflow-hidden rounded-md border">
      <div className="flex items-center gap-1 border-b bg-muted/40 p-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Parent folder"
          disabled={!current?.parent}
          onClick={() => current?.parent && setPath(current.parent)}
        >
          <ArrowUpIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground [direction:rtl]">
          {/* rtl keeps the end of a long path in view; the mark keeps the leading slash in place. */}
          &lrm;{current?.path ?? path ?? "~"}
        </span>
      </div>
      <ScrollArea className="h-56">
        <div className="flex flex-col p-1">
          {listing.isPending &&
            Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="m-1 h-6" />)}
          {listing.isError && (
            <p className="p-2 text-sm text-destructive">{listing.error.message}</p>
          )}
          {current?.folders.length === 0 && (
            <p className="p-2 text-sm text-muted-foreground">No folders inside.</p>
          )}
          {current?.folders.map((folder) => (
            <Item
              key={folder.path}
              size="xs"
              render={
                <button type="button" className="text-left" onClick={() => setPath(folder.path)}>
                  <ItemMedia variant="icon">
                    {folder.workspace ? <FolderCheckIcon /> : <FolderIcon />}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="truncate font-normal">{folder.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    {folder.workspace && <Badge variant="secondary">Workspace</Badge>}
                    <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                  </ItemActions>
                </button>
              }
            />
          ))}
        </div>
      </ScrollArea>
      <div className="flex items-center justify-end gap-2 border-t p-1.5">
        <Button
          type="button"
          size="sm"
          disabled={current === undefined}
          onClick={() => current && onChoose(current.path)}
        >
          Use {current ? `“${basename(current.path) || current.path}”` : "this folder"}
        </Button>
      </div>
    </div>
  );
}
