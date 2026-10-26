import type { Task, WorkspaceSnapshot } from "@octodo/core";
import { useActorRef, useSelector } from "@xstate/react";
import { format, parseISO } from "date-fns";
import {
  AlertCircleIcon,
  CalendarIcon,
  CheckIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fromPromise } from "xstate";
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
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useDeleteTask, useMoveTask, useUpdateTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dueInfo, formatTimestamp, listLabel, PRIORITIES, todayKey } from "@/lib/tasks";
import { changes, editorMachine } from "@/machines/editor";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  onClose: () => void;
}

const NO_LIST = "__none__";

/** A property value: a quiet full-width button, Linear style. */
const PROPERTY = "w-full justify-start px-2 font-normal";

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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-4">
        <span className="text-xs font-medium text-muted-foreground tabular-nums">{task.id}</span>
        <SaveState
          phase={String(phase)}
          error={error}
          onRetry={() => editor.send({ type: "RETRY" })}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2Icon />
                  Delete task
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <XIcon />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-3 pt-4 pb-16">
          <div className="flex flex-col gap-1">
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
              className="min-h-0 resize-none border-transparent bg-transparent px-2 py-1 text-lg leading-snug font-semibold shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
            />

            <div className="group/notes relative">
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

          <section className="rounded-lg border bg-card p-1.5 pb-2">
            <h2 className="flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
              Properties
            </h2>
            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-y-0.5">
              <dt className="px-2 text-muted-foreground">Status</dt>
              <dd>
                <StatusMenu workspace={workspace} snapshot={snapshot} task={task}>
                  <Button variant="ghost" size="sm" className={PROPERTY}>
                    <StatusIcon category={currentStatus?.category} />
                    <span className="truncate">{currentStatus?.name ?? task.status}</span>
                  </Button>
                </StatusMenu>
              </dd>

              <dt className="px-2 text-muted-foreground">Priority</dt>
              <dd>
                <PriorityMenu workspace={workspace} task={task}>
                  <Button variant="ghost" size="sm" className={PROPERTY}>
                    <PriorityIcon priority={task.priority} />
                    <span className="truncate">{priorityLabel}</span>
                  </Button>
                </PriorityMenu>
              </dd>

              <dt className="px-2 text-muted-foreground">List</dt>
              <dd>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(PROPERTY, task.list === null && "text-muted-foreground")}
                    >
                      <ListGlyph />
                      <span className="truncate">{listLabel(snapshot.lists, task.list)}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
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
                      {snapshot.lists.map((list) => {
                        return (
                          <DropdownMenuRadioItem key={list.id} value={list.id}>
                            <ListGlyph />
                            {listLabel(snapshot.lists, list.id)}
                          </DropdownMenuRadioItem>
                        );
                      })}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </dd>

              <dt className="self-start px-2 pt-1.5 text-muted-foreground">Tags</dt>
              <dd>
                <TagsEditor
                  tags={task.tags}
                  onChange={(tags) => update.mutate({ id: task.id, patch: { tags } })}
                />
              </dd>

              <dt className="px-2 text-muted-foreground">Due</dt>
              <dd>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        PROPERTY,
                        task.due === null && "text-muted-foreground",
                        due?.overdue && "text-destructive",
                      )}
                    >
                      <CalendarIcon />
                      {task.due ? format(parseISO(task.due), "EEE, MMM d, yyyy") : "Set due date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={task.due ? parseISO(task.due) : undefined}
                      {...(task.due ? { defaultMonth: parseISO(task.due) } : {})}
                      onSelect={(date) => setDue(date ? format(date, "yyyy-MM-dd") : null)}
                    />
                    <div className="flex gap-1 border-t p-2">
                      <Button variant="ghost" size="xs" onClick={() => setDue(todayKey())}>
                        Today
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          const tomorrow = new Date();
                          tomorrow.setDate(tomorrow.getDate() + 1);
                          setDue(format(tomorrow, "yyyy-MM-dd"));
                        }}
                      >
                        Tomorrow
                      </Button>
                      {task.due && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="ml-auto"
                          onClick={() => setDue(null)}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </dd>
            </dl>

            <Separator className="my-2" />

            <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-y-1.5 px-2 text-xs text-muted-foreground">
              <dt>ID</dt>
              <dd className="tabular-nums">{task.id}</dd>
              <dt>File</dt>
              <dd className="font-mono break-all">{task.path}</dd>
              <dt>Created</dt>
              <dd>{formatTimestamp(task.created)}</dd>
              <dt>Updated</dt>
              <dd>{formatTimestamp(task.updated)}</dd>
            </dl>
          </section>
        </div>
      </ScrollArea>

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

function SaveState({
  phase,
  error,
  onRetry,
}: {
  phase: string;
  error: string | null;
  onRetry: () => void;
}) {
  if (phase === "editing") return <span className="text-xs text-muted-foreground">Editing…</span>;
  if (phase === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        Saving
      </span>
    );
  }
  if (phase === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckIcon className="size-3" />
        Saved
      </span>
    );
  }
  if (phase === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1 text-xs text-destructive"
        title={error ?? undefined}
      >
        <AlertCircleIcon className="size-3" />
        Not saved, retry
      </button>
    );
  }
  return null;
}
