import type { Entry, WorkspaceSnapshot } from "@octodo/contract";
import { useState } from "react";
import { PaneHeader } from "@octodo/ui/components/pane";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import type { EnabledSection } from "@/components/section";
import { PanelActions, SaveState, TitleField, useTitleBody } from "@/components/task-detail";
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
        <PanelActions
          item={entry}
          noun={web.noun}
          onClose={onClose}
          onDelete={() => setConfirmDelete(true)}
        />
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
