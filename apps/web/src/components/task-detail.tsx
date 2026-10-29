import type { Task, WorkspaceSnapshot } from "@octodo/contract";
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
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { toastManager } from "@octodo/ui/components/toast";
import { fromPromise } from "xstate";
import { DuePicker } from "@/components/due-picker";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import {
  ListGlyph,
  PriorityIcon,
  PriorityMenu,
  StatusIcon,
  StatusMenu,
  TagPill,
} from "@/components/task-bits";
import { PaneFooter, PaneHeader } from "@octodo/ui/components/pane";
import { TagsEditor } from "@/components/tags-editor";
import { KindPanel } from "@/components/task-kind";
import { offersDue } from "@/lib/task-kind";
import { TaskRelations, useMentions } from "@/components/task-relations";
import { ParentLink, SubtasksGoing, TaskSubtasks } from "@/components/task-subtasks";
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { Textarea } from "@octodo/ui/components/textarea";
import { taskAttachments, useDeleteTask, useMoveTask, useUpdateTask } from "@/lib/api";
import { cn } from "@octodo/ui/lib/utils";
import { useToday } from "@octodo/ui/hooks/use-today";
import { dueInfo, formatTimestamp } from "@octodo/ui/lib/dates";
import { listLabel, PRIORITIES } from "@/lib/tasks";
import { changes, type Draft, editorMachine } from "@/machines/editor";

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

  const { editor, draft, error, phase, editBody } = useTitleBody(task, (patch) =>
    update.mutateAsync({ id: task.id, patch }),
  );
  const mentions = useMentions(workspace, snapshot, task.id);
  const setDue = (due: string | null) => update.mutate({ id: task.id, patch: { due } });

  const currentStatus = snapshot.statuses.find((status) => status.id === task.status);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader className="pe-2">
        <StatusMenu workspace={workspace} snapshot={snapshot} task={task}>
          <Button
            variant="ghost"
            size="icon-xs"
            className="-ms-1"
            aria-label={`Status: ${currentStatus?.name ?? task.status}`}
            title={currentStatus?.name ?? task.status}
          >
            <StatusIcon category={currentStatus?.category} />
          </Button>
        </StatusMenu>
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1">
          <ParentLink workspace={workspace} snapshot={snapshot} task={task} />
          <span aria-current="page" className="shrink-0 font-mono text-xs text-muted-foreground">
            {task.id}
          </span>
        </nav>
        <SaveState
          phase={String(phase)}
          error={error}
          onRetry={() => editor.send({ type: "RETRY" })}
        />
        <PanelActions
          item={task}
          noun="task"
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
        attachments={taskAttachments(workspace, task.id)}
        {...mentions}
        value={draft.body}
        onChange={editBody}
        onBlur={() => editor.send({ type: "FLUSH" })}
        className="min-h-0 flex-1 text-base md:text-sm"
      />
      <KindPanel workspace={workspace} task={task} />
      <TaskRelations workspace={workspace} snapshot={snapshot} task={task} />
      <TaskSubtasks workspace={workspace} snapshot={snapshot} task={task} />

      <PaneFooter className="gap-0.5 px-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="min-w-0 font-normal text-muted-foreground"
                aria-label={`List: ${listLabel(snapshot.lists, task.list)}`}
              >
                <ListGlyph />
                <span className="truncate">{listLabel(snapshot.lists, task.list)}</span>
              </Button>
            }
          />
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

        {offersDue(task) && <TaskDueButton task={task} onChange={setDue} />}

        <TaskPriorityButton workspace={workspace} task={task} />

        <TaskTagsButton
          tags={task.tags}
          onChange={(tags) => update.mutate({ id: task.id, patch: { tags } })}
        />
      </PaneFooter>

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
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() => {
                remove.mutate(task.id);
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

function TaskDueButton({ task, onChange }: { task: Task; onChange: (due: string | null) => void }) {
  const due = dueInfo(task.due, useToday());
  return (
    <DuePicker value={task.due} onChange={onChange}>
      <Button
        variant="ghost"
        size="xs"
        title={task.due ? `Due ${format(parseISO(task.due), "EEE, MMM d, yyyy")}` : undefined}
        className={cn(
          "font-normal text-muted-foreground tabular-nums",
          due && "text-foreground",
          due?.overdue && "text-destructive hover:text-destructive",
        )}
      >
        <CalendarIcon data-icon="inline-start" />
        {due ? due.label : "Due"}
      </Button>
    </DuePicker>
  );
}

function TaskPriorityButton({ workspace, task }: { workspace: string; task: Task }) {
  const priority =
    task.priority === "none"
      ? undefined
      : PRIORITIES.find((entry) => entry.value === task.priority);
  return (
    <PriorityMenu workspace={workspace} task={task}>
      <Button
        variant="ghost"
        size="xs"
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
  );
}

function TaskTagsButton({
  tags,
  onChange,
}: {
  tags: ReadonlyArray<string>;
  onChange: (tags: Array<string>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="min-w-0 font-normal text-muted-foreground"
            aria-label={tags.length === 0 ? "Add tags" : `Tags: ${tags.join(", ")}`}
            title={tags.map((tag) => `#${tag}`).join(" ") || undefined}
          >
            {tags.length === 0 ? (
              <>
                <HashIcon data-icon="inline-start" />
                Tags
              </>
            ) : (
              <span className="flex min-w-0 items-center gap-1">
                {tags.map((tag) => (
                  <TagPill key={tag} tag={tag} />
                ))}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="start" side="top" className="w-72 p-1.5">
        <TagsEditor autoFocus tags={tags} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

/** A panel's header actions: the menu with the file's details, copy path and delete, and close. */
export function PanelActions({
  item,
  noun,
  onClose,
  onDelete,
}: {
  item: Pick<Task, "id" | "path" | "created" | "updated">;
  noun: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <>
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
              <dd className="font-mono text-foreground">{item.id}</dd>
              <dt>File</dt>
              <dd className="font-mono break-all">{item.path}</dd>
              <dt>Created</dt>
              <dd className="font-mono">{formatTimestamp(item.created)}</dd>
              <dt>Updated</dt>
              <dd className="font-mono">{formatTimestamp(item.updated)}</dd>
            </dl>
            <DropdownMenuItem
              onClick={() =>
                void navigator.clipboard
                  .writeText(item.path)
                  .then(() => toastManager.add({ type: "success", title: "File path copied" }))
              }
            >
              <CopyIcon />
              Copy path
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete {noun}
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
    </>
  );
}

/**
 * The title and body editor of a panel, a task's or an entry's: debounced saves through `save`,
 * edits made elsewhere adopted unless there are unsaved ones, and what was typed saved on close.
 * `save` goes through TanStack Query so it shares the optimistic cache update; the panel is keyed
 * by its id, so the one it is mounted with is the one it keeps.
 */
export function useTitleBody(saved: Draft, save: (patch: Partial<Draft>) => Promise<unknown>) {
  const editor = useActorRef(
    editorMachine.provide({
      actors: {
        save: fromPromise(async ({ input }) => {
          await save(input.patch);
          return input.draft;
        }),
      },
    }),
    { input: { title: saved.title, body: saved.body } },
  );
  const draft = useSelector(editor, (state) => state.context.draft);
  const error = useSelector(editor, (state) => state.context.error);
  const phase = useSelector(editor, (state) => state.value);

  useEffect(() => {
    editor.send({ type: "EXTERNAL", draft: { title: saved.title, body: saved.body } });
  }, [editor, saved.title, saved.body]);

  // Closing the panel mid-debounce still saves what was typed, and an image upload that
  // finishes after it closed saves the body directly.
  const open = useRef(true);
  const saveUnsaved = useEffectEvent(() => {
    const patch = changes(editor.getSnapshot().context);
    if (Object.keys(patch).length > 0) void save(patch).catch(() => {});
  });
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      saveUnsaved();
    };
  }, [editor]);

  const editBody = (value: string) =>
    open.current
      ? editor.send({ type: "EDIT", field: "body", value })
      : void save({ body: value }).catch(() => {});

  return { editor, draft, error, phase, editBody };
}

/** The save state, kept quiet: a muted mono word while saving, a retry link when it failed. */
export function SaveState({
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
  "min-h-7 w-full min-w-0 text-lg leading-7 font-semibold tracking-[-0.015em] md:text-lg";

/** Character offset of the point in `element`'s text, if the point is on it. */
const offsetAt = (element: HTMLElement, x: number, y: number) => {
  const position = document.caretPositionFromPoint?.(x, y);
  return position && element.contains(position.offsetNode) ? position.offset : undefined;
};

/**
 * The task title: one truncated line while reading, every line while editing. Clicking it starts
 * editing with the caret where it was clicked.
 */
export function TitleField({
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
  }, [caret]);

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
