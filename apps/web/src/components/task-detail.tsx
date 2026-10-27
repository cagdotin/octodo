import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { useActorRef, useSelector } from "@xstate/react";
import { format, parseISO } from "date-fns";
import {
  AlertCircleIcon,
  CalendarIcon,
  CopyIcon,
  FlagIcon,
  HashIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { fromPromise } from "xstate";
import { DuePicker } from "@/components/due-picker";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import {
  ListGlyph,
  PriorityIcon,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
  TagChips,
} from "@/components/task-bits";
import { TagsEditor } from "@/components/tags-editor";
import { ParentLink, SubtasksGoing, TaskSubtasks } from "@/components/task-subtasks";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteTask, useMoveTask, useUpdateTask } from "@/lib/api";
import { taskAttachments } from "@/lib/attachments";
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
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      const patch = changes(editor.getSnapshot().context);
      if (Object.keys(patch).length > 0) void save({ id: task.id, patch }).catch(() => {});
    };
  }, [editor, task.id]);

  const setDue = (due: string | null) => update.mutate({ id: task.id, patch: { due } });
  const due = dueInfo(task.due);

  const currentStatus = snapshot.statuses.find((status) => status.id === task.status);
  const priority =
    task.priority === "none"
      ? undefined
      : PRIORITIES.find((entry) => entry.value === task.priority);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ParentLink workspace={workspace} snapshot={snapshot} task={task} />
      <div className="flex shrink-0 items-start gap-1 border-b px-3.5 py-3 desktop-mac:app-drag">
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
        <TitleField
          value={draft.title}
          onChange={(value) => editor.send({ type: "EDIT", field: "title", value })}
          onCommit={() => editor.send({ type: "FLUSH" })}
        />
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <MarkdownEditor
        aria-label="Notes"
        placeholder="Add notes in markdown…"
        attachments={taskAttachments(workspace, task.id)}
        value={draft.body}
        onChange={(value) =>
          open.current
            ? editor.send({ type: "EDIT", field: "body", value })
            : void save({ id: task.id, patch: { body: value } }).catch(() => {})
        }
        onBlur={() => editor.send({ type: "FLUSH" })}
        className="min-h-0 flex-1 text-base md:text-sm"
      />
      <TaskSubtasks workspace={workspace} snapshot={snapshot} task={task} />

      <div className="flex h-11 shrink-0 items-center gap-0.5 border-t pr-3.5 pl-2">
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

        <DuePicker value={task.due} onChange={setDue}>
          <Button
            variant="ghost"
            size="sm"
            title={task.due ? `Due ${format(parseISO(task.due), "EEE, MMM d, yyyy")}` : undefined}
            className={cn(
              "font-mono text-xs font-normal text-muted-foreground",
              due && "text-foreground",
              due?.overdue && "text-destructive hover:text-destructive",
            )}
          >
            <CalendarIcon data-icon="inline-start" />
            {due ? due.label : "Due"}
          </Button>
        </DuePicker>

        <PriorityMenu workspace={workspace} task={task}>
          <Button
            variant="ghost"
            size="sm"
            className={cn("font-normal text-muted-foreground", priority && "text-foreground")}
            aria-label={`Priority: ${priority?.label ?? "none"}`}
          >
            {priority ? (
              <PriorityIcon priority={priority.value} />
            ) : (
              <FlagIcon data-icon="inline-start" />
            )}
            {priority?.label ?? "Priority"}
          </Button>
        </PriorityMenu>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 font-normal text-muted-foreground"
              aria-label={task.tags.length === 0 ? "Add tags" : `Tags: ${task.tags.join(", ")}`}
              title={task.tags.map((tag) => `#${tag}`).join(" ") || undefined}
            >
              {task.tags.length === 0 ? (
                <>
                  <HashIcon data-icon="inline-start" />
                  Tags
                </>
              ) : (
                <TagChips tags={task.tags} />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" side="top" collisionPadding={8} className="w-72 p-1.5">
            <TagsEditor
              autoFocus
              tags={task.tags}
              onChange={(tags) => update.mutate({ id: task.id, patch: { tags } })}
            />
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex shrink-0 items-center">
          <SaveState
            phase={String(phase)}
            error={error}
            onRetry={() => editor.send({ type: "RETRY" })}
          />
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {task.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes{" "}
              <span className="font-mono">
                {task.path.slice(0, task.path.lastIndexOf("/") + 1)}
              </span>{" "}
              and everything in it
              <SubtasksGoing snapshot={snapshot} task={task} />.
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

const TITLE_TEXT =
  "min-h-7 min-w-0 flex-1 px-0.5 text-lg leading-7 font-semibold tracking-[-0.015em] md:text-lg";

/** Character offset of the point in `element`'s text, if the point is on it. */
const offsetAt = (element: HTMLElement, x: number, y: number) => {
  const position = document.caretPositionFromPoint?.(x, y);
  return position && element.contains(position.offsetNode) ? position.offset : undefined;
};

/**
 * The task title: one truncated line while reading, every line while editing. Clicking it starts
 * editing with the caret where it was clicked.
 */
function TitleField({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const [caret, setCaret] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const editing = caret !== null;

  useLayoutEffect(() => {
    if (caret === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(caret, caret);
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Title: ${value}`}
        title={value}
        className={cn(TITLE_TEXT, "cursor-text truncate text-left outline-none")}
        onMouseDown={(event) => {
          event.preventDefault();
          setCaret(offsetAt(event.currentTarget, event.clientX, event.clientY) ?? value.length);
        }}
        onFocus={() => setCaret(value.length)}
      >
        {value}
      </button>
    );
  }

  return (
    <Textarea
      ref={input}
      aria-label="Title"
      value={value}
      rows={1}
      onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        blurOnEscape(event);
      }}
      onBlur={() => {
        onCommit();
        setCaret(null);
      }}
      className={cn(
        TITLE_TEXT,
        "resize-none rounded-none border-0 bg-transparent py-0 shadow-none focus-visible:ring-0 dark:bg-transparent",
      )}
    />
  );
}
