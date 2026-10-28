import type { Entry, WorkspaceSnapshot } from "@octodo/contract";
import { CopyIcon, MoreHorizontalIcon, PanelRightCloseIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import type { EnabledSection } from "@/components/section";
import { SaveState, TitleField, useTitleBody } from "@/components/task-detail";
import { useMentions } from "@/components/task-relations";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@octodo/ui/components/alert-dialog";
import { Button } from "@octodo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@octodo/ui/components/dropdown-menu";
import { formatTimestamp } from "@octodo/ui/lib/dates";
import { useDeleteEntry, useEditEntry } from "@/lib/api";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  section: EnabledSection;
  entry: Entry;
  onClose: () => void;
}

/**
 * The panel of an entry of a section, shaped like the task panel: the title and the body, which
 * every entry has and the app edits through its plugin's `edit`, then the plugin's own `Panel`.
 */
export function EntryDetail({ workspace, snapshot, section, entry, onClose }: Props) {
  const { web } = section;
  const update = useEditEntry(workspace, web);
  const remove = useDeleteEntry(workspace, web);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { editor, draft, error, phase, editBody } = useTitleBody(entry, (patch) =>
    update.mutateAsync({ id: entry.id, patch }),
  );
  const mentions = useMentions(workspace, snapshot, entry.id);
  const folder = entry.path.slice(0, entry.path.lastIndexOf("/") + 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-1 border-b px-3.5 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center text-muted-foreground">
          <web.EntryIcon fields={entry.fields} className="size-4" />
        </span>
        <TitleField
          value={draft.title}
          onChange={(value) => editor.send({ type: "EDIT", field: "title", value })}
          onCommit={() => editor.send({ type: "FLUSH" })}
        />
        <div className="flex h-7 shrink-0 items-center">
          <SaveState
            phase={String(phase)}
            error={error}
            onRetry={() => editor.send({ type: "RETRY" })}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label="More actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onClose}>
                <PanelRightCloseIcon />
                Close panel
                <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-1.5 py-1.5 text-xs text-muted-foreground">
                <dt>ID</dt>
                <dd className="font-mono text-foreground">{entry.id}</dd>
                <dt>File</dt>
                <dd className="font-mono break-all">{entry.path}</dd>
                <dt>Created</dt>
                <dd className="font-mono">{formatTimestamp(entry.created)}</dd>
                <dt>Updated</dt>
                <dd className="font-mono">{formatTimestamp(entry.updated)}</dd>
              </dl>
              <DropdownMenuItem
                onSelect={() =>
                  void navigator.clipboard
                    .writeText(entry.path)
                    .then(() => toast.success("File path copied"))
                }
              >
                <CopyIcon />
                Copy path
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete {web.noun}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <MarkdownEditor
        aria-label="Notes"
        placeholder="Add notes in markdown…"
        {...mentions}
        value={draft.body}
        onChange={editBody}
        onBlur={() => editor.send({ type: "FLUSH" })}
        className="min-h-0 flex-1 text-base md:text-sm"
      />
      <web.Panel workspace={workspace} entry={entry} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {entry.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <span className="font-mono">{folder}</span> and everything in it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove.mutate(entry.id);
                onClose();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
