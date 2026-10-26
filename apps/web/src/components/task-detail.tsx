import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { useActorRef, useSelector } from "@xstate/react";
import { format, parseISO } from "date-fns";
import {
  AlertCircleIcon,
  CalendarIcon,
  CopyIcon,
  FlagIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { fromPromise } from "xstate";
import { DuePicker } from "@/components/due-picker";
import {
  ListGlyph,
  PriorityIcon,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
} from "@/components/task-bits";
import { TagsEditor } from "@/components/tags-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteTask, useMoveTask, useUpdateTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dueInfo, formatTimestamp, listLabel, PRIORITIES } from "@/lib/tasks";
import { changes, editorMachine } from "@/machines/editor";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  onClose: () => void;
}

const NO_LIST = "__none__";

const blurOnEscape = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === "Escape") {
    event.preventDefault();
    event.currentTarget.blur();
  }
};

export function TaskDetail({ workspace, snapshot, task, onClose }: Props) {
  const update = useUpdateTask(workspace);
  const move = useMoveTask(workspace);
  const remove = useDeleteTask(workspace);
  const [mode, setMode] = useState<"write" | "preview">(
    task.body.trim() === "" ? "write" : "preview",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The save actor goes through TanStack Query so it shares the optimistic cache update.
  // `mutateAsync` is stable for the lifetime of the mutation observer.
  const save = update.mutateAsync;
  const editor = useActorRef(
    editorMachine.provide({
      actors: {
        save: fromPromise(async ({ input }) => {
          await save({ id: task.id, patch: input.patch });
          return input.draft;
        }),
      },
    }),
    { input: { title: task.title, body: task.body } },
  );
  const draft = useSelector(editor, (state) => state.context.draft);
  const error = useSelector(editor, (state) => state.context.error);
  const phase = useSelector(editor, (state) => state.value);

  useEffect(() => {
    editor.send({ type: "EXTERNAL", draft: { title: task.title, body: task.body } });
  }, [editor, task.title, task.body]);

  // Closing the pane mid-debounce still saves what was typed.
  useEffect(
    () => () => {
      const patch = changes(editor.getSnapshot().context);
      if (Object.keys(patch).length > 0) void save({ id: task.id, patch }).catch(() => {});
    },
    [editor, task.id],
  );

  const setDue = (due: string | null) => update.mutate({ id: task.id, patch: { due } });
  const due = dueInfo(task.due);

  const currentStatus = snapshot.statuses.find((status) => status.id === task.status);
  const priorityLabel = PRIORITIES.find((entry) => entry.value === task.priority)?.label;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* TickTick-style header: done-ness and when on the left, priority on the right. */}
      <div className="flex h-13 shrink-0 items-center gap-1 border-b px-3 desktop-mac:app-drag">
        <StatusMenu workspace={workspace} snapshot={snapshot} task={task}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Status: ${currentStatus?.name ?? task.status}`}
            title={currentStatus?.name ?? task.status}
          >
            <StatusIcon category={currentStatus?.category} className="size-4" />
          </Button>
        </StatusMenu>
        <Separator
          orientation="vertical"
          className="mx-1 data-vertical:h-4 data-vertical:self-center"
        />
        <DuePicker value={task.due} onChange={setDue}>
          <Button
            variant="ghost"
            size="sm"
            title={task.due ? `Due ${format(parseISO(task.due), "EEE, MMM d, yyyy")}` : undefined}
            className={cn(
              "px-2 font-mono text-xs font-normal",
              due === null && "text-muted-foreground",
              due?.overdue && "text-destructive hover:text-destructive",
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {due ? due.label : "Due date"}
          </Button>
        </DuePicker>
        <div className="ml-auto flex items-center gap-1">
          <SaveState
            phase={String(phase)}
            error={error}
            onRetry={() => editor.send({ type: "RETRY" })}
          />
          <PriorityMenu workspace={workspace} task={task}>
            <Button variant="ghost" size="icon-sm" aria-label={`Priority: ${priorityLabel}`}>
              {/* The "none" glyph reads as a "…" button up here, so an unset priority is a flag. */}
              {task.priority === "none" ? (
                <FlagIcon className="text-muted-foreground" />
              ) : (
                <PriorityIcon priority={task.priority} />
              )}
            </Button>
          </PriorityMenu>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-3 pt-3 pb-16">
          <Textarea
            aria-label="Title"
            value={draft.title}
            rows={1}
            onChange={(event) =>
              editor.send({
                type: "EDIT",
                field: "title",
                value: event.target.value.replace(/\n/g, " "),
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor.send({ type: "FLUSH" });
              }
              blurOnEscape(event);
            }}
            onBlur={() => editor.send({ type: "FLUSH" })}
            className="min-h-0 resize-none border-transparent bg-transparent px-2 py-1 text-xl leading-snug font-semibold tracking-[-0.02em] shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-xl dark:bg-transparent"
          />

          <TagsEditor
            tags={task.tags}
            onChange={(tags) => update.mutate({ id: task.id, patch: { tags } })}
          />

          <div className="group/notes relative mt-1">
            {mode === "write" ? (
              <Textarea
                aria-label="Notes"
                placeholder="Add notes in markdown…"
                value={draft.body}
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- follows a click on the preview.
                autoFocus={draft.body.trim() !== ""}
                onChange={(event) =>
                  editor.send({ type: "EDIT", field: "body", value: event.target.value })
                }
                onBlur={() => {
                  editor.send({ type: "FLUSH" });
                  if (draft.body.trim() !== "") setMode("preview");
                }}
                onKeyDown={blurOnEscape}
                className="min-h-32 resize-none border-transparent bg-transparent px-2 text-[13px] leading-relaxed shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
              />
            ) : (
              <>
                {/* Clicking the rendered notes edits them; links and checkboxes still work. */}
                {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the Edit button below is the keyboard path. */}
                <div
                  className="min-h-16 cursor-text rounded-lg px-2 py-2"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a, input")) return;
                    setMode("write");
                  }}
                >
                  <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:font-semibold prose-a:text-primary [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-1">
                    <Markdown remarkPlugins={[remarkGfm]}>{draft.body}</Markdown>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  className="absolute top-1 right-1 opacity-0 group-hover/notes:opacity-100 focus-visible:opacity-100"
                  onClick={() => setMode("write")}
                >
                  <PencilIcon data-icon="inline-start" />
                  Edit
                </Button>
              </>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Footer: where the task lives on the left, everything else behind "…". */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-t px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 font-normal text-muted-foreground"
              aria-label={`List: ${listLabel(snapshot.lists, task.list)}`}
            >
              <ListGlyph />
              <span className="truncate">{listLabel(snapshot.lists, task.list)}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuRadioGroup
              value={task.list ?? NO_LIST}
              onValueChange={(value) =>
                move.mutate({
                  id: task.id,
                  move: { list: value === NO_LIST ? null : value },
                })
              }
            >
              <DropdownMenuRadioItem value={NO_LIST}>
                <LayersIcon />
                No list
              </DropdownMenuRadioItem>
              {snapshot.lists.map((list) => (
                <DropdownMenuRadioItem key={list.id} value={list.id}>
                  <ListGlyph />
                  {listLabel(snapshot.lists, list.id)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto text-muted-foreground"
              aria-label="More actions"
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          {/* Opens upward, so "Close panel" sits right above the button. */}
          <DropdownMenuContent align="end" side="top" className="w-64">
            <DropdownMenuGroup>
              <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 px-1.5 py-1.5 text-xs text-muted-foreground">
                <dt>ID</dt>
                <dd className="font-mono text-foreground">{task.id}</dd>
                <dt>File</dt>
                <dd className="font-mono break-all">{task.path}</dd>
                <dt>Created</dt>
                <dd className="font-mono">{formatTimestamp(task.created)}</dd>
                <dt>Updated</dt>
                <dd className="font-mono">{formatTimestamp(task.updated)}</dd>
              </dl>
              <DropdownMenuItem
                onSelect={() =>
                  void navigator.clipboard
                    .writeText(task.path)
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
                Delete task
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onClose}>
                <PanelRightCloseIcon />
                Close panel
                <DropdownMenuShortcut>Esc</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {task.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes <span className="font-mono">{task.path}</span> from disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove.mutate(task.id);
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

/** The save state, kept quiet: a muted mono word while saving, a retry link when it failed. */
function SaveState({
  phase,
  error,
  onRetry,
}: {
  phase: string;
  error: string | null;
  onRetry: () => void;
}) {
  if (phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 rounded-md px-1 font-mono text-[11px] text-destructive hover:underline"
        title={error ?? undefined}
      >
        <AlertCircleIcon className="size-3" />
        Retry save
      </button>
    );
  }
  const label =
    phase === "editing" || phase === "saving" ? "Saving…" : phase === "saved" ? "Saved" : null;
  if (label === null) return null;
  return (
    <span aria-live="polite" className="px-1 font-mono text-[11px] text-muted-foreground">
      {label}
    </span>
  );
}
