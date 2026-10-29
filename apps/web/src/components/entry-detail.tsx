import type { Entry, WorkspaceSnapshot } from "@octodo/contract";
import { CopyIcon, MoreHorizontalIcon, PanelRightCloseIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { toastManager } from "@octodo/ui/components/toast";
import { PaneHeader } from "@octodo/ui/components/pane";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import type { EnabledSection } from "@/components/section";
import { SaveState, TitleField, useTitleBody } from "@/components/task-detail";
import { useMentions } from "@/components/task-relations";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
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
      <PaneHeader className="pe-2">
        <web.EntryIcon fields={entry.fields} className="size-3.5 shrink-0 text-muted-foreground" />
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
          <span aria-current="page" className="shrink-0 font-mono text-xs text-muted-foreground">
            {entry.id}
          </span>
        </nav>
        <SaveState
          phase={String(phase)}
          error={error}
          onRetry={() => editor.send({ type: "RETRY" })}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="More actions"
              >
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onClose}>
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
                onClick={() =>
                  void navigator.clipboard
                    .writeText(entry.path)
                    .then(() => toastManager.add({ type: "success", title: "File path copied" }))
                }
              >
                <CopyIcon />
                Copy path
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete {web.noun}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Close panel"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </PaneHeader>

      <div className="shrink-0 px-4 pt-4">
        <TitleField
          value={draft.title}
          onChange={(value) => editor.send({ type: "EDIT", field: "title", value })}
          onCommit={() => editor.send({ type: "FLUSH" })}
        />
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
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() => {
                remove.mutate(entry.id);
                onClose();
              }}
            >
              Delete
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
