import type { List, Priority, WorkspaceSnapshot } from "@octodo/core";
import {
  CalendarIcon,
  HashIcon,
  LayoutTemplateIcon,
  MoreHorizontalIcon,
  NotebookTextIcon,
  PaperclipIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { DuePicker } from "@/components/due-picker";
import { completing } from "@/components/quick-add/editor";
import { QuickAddInput, type QuickAddInputHandle } from "@/components/quick-add/quick-add-input";
import { suggestionsFor, useQuickAdd } from "@/components/quick-add/use-quick-add";
import { ListGlyph, PriorityIcon, StatusIcon } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { defaultStatus } from "@octodo/core/layout";
import { useCreateTask } from "@/lib/api";
import { withoutRanges, type QuickAddToken } from "@/lib/quick-add";
import { cn } from "@/lib/utils";
import {
  allTags,
  dueInfo,
  isSmartView,
  listLabel,
  listTree,
  PRIORITIES,
  SMART,
  todayKey,
  type ListNode,
} from "@/lib/tasks";

/** The priorities offered here, strongest first, as TickTick's row of flags. */
const MENU_PRIORITIES: ReadonlyArray<Priority> = ["urgent", "high", "medium", "none"];

/** Not built yet: listed so the menu has its final shape, but disabled. */
const LATER: ReadonlyArray<{ label: string; icon: LucideIcon }> = [
  { label: "Attachment", icon: PaperclipIcon },
  { label: "Add from Template", icon: LayoutTemplateIcon },
  { label: "Convert to Note", icon: NotebookTextIcon },
];

/** Lists in sidebar order with their depth, for an indented menu. */
const flatLists = (
  nodes: ReadonlyArray<ListNode>,
  depth = 0,
): Array<{ list: List; depth: number }> =>
  nodes.flatMap((node) => [{ list: node.list, depth }, ...flatLists(node.children, depth + 1)]);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
  snapshot: WorkspaceSnapshot;
  /** The current `list` search param: a real list is the default target, Today the due date. */
  list: string | undefined;
  /** Prefilled title, e.g. the command palette's query. */
  title?: string;
  /** Opens the created task (⌘↵). */
  onOpenTask: (id: string) => void;
}

/**
 * The new-task dialog, opened by N / C, the sidebar and the command palette. A title that
 * understands the quick-add tokens (`!high #tag due:tomorrow`), notes, and a row of property
 * buttons whose picks merge with the tokens. Enter creates the task and closes the dialog,
 * ⌘Enter also opens it.
 */
export function NewTaskDialog({ open, onOpenChange, ...props }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 rounded-xl! p-0 shadow-2xl sm:max-w-xl"
        onEscapeKeyDown={(event) => {
          if (completing(event.target)) event.preventDefault();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Type a title, set its properties and press Enter.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from a blank draft. */}
        <NewTaskForm {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewTaskForm({
  workspace,
  snapshot,
  list,
  title: initialTitle = "",
  onOpenTask,
  onDone,
}: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const create = useCreateTask(workspace);
  const titleInput = useRef<QuickAddInputHandle>(null);
  const draft = useQuickAdd(snapshot.lists, initialTitle);
  const suggestions = useMemo(() => suggestionsFor(snapshot), [snapshot]);
  const [notes, setNotes] = useState("");
  // Picks from the buttons; undefined means "whatever the tokens or the view say".
  const [pickedStatus, setPickedStatus] = useState<string>();
  const [pickedPriority, setPickedPriority] = useState<Priority>();
  const [pickedDue, setPickedDue] = useState<string | null>();
  const [pickedList, setPickedList] = useState<string | null>();
  const [pickedTags, setPickedTags] = useState<Array<string>>([]);

  const { parsed } = draft;
  // A pick from the buttons replaces what the tokens said, so the dialog shows one answer.
  const dropTokens = (drop: (token: QuickAddToken) => boolean) =>
    draft.setText(
      withoutRanges(
        draft.text,
        parsed.ranges.filter((range) => drop(range.token)),
      ),
    );
  const status =
    snapshot.statuses.find((entry) => entry.id === pickedStatus) ??
    defaultStatus(snapshot.statuses);
  const priority = parsed.fields.priority ?? pickedPriority ?? "none";
  const due =
    parsed.fields.due ??
    (pickedDue === undefined ? (list === SMART.today ? todayKey() : null) : pickedDue);
  const viewList = isSmartView(list) ? null : (list ?? null);
  const targetList = parsed.fields.list ?? (pickedList === undefined ? viewList : pickedList);
  const tags = [...new Set([...pickedTags, ...parsed.fields.tags])];
  const knownTags = [...new Set([...allTags(snapshot.tasks), ...tags])].sort((a, b) =>
    a.localeCompare(b),
  );
  const dueLabel = dueInfo(due);
  const ready = parsed.title !== "" && status !== undefined;

  const toggleTag = (tag: string) => {
    if (parsed.fields.tags.includes(tag)) {
      dropTokens((token) => token.kind === "tag" && token.tag === tag);
    }
    setPickedTags(
      tags.includes(tag) ? pickedTags.filter((entry) => entry !== tag) : [...pickedTags, tag],
    );
  };

  const submit = (open: boolean) => {
    if (!ready) return;
    create.mutate(
      {
        title: parsed.title,
        status: status.id,
        tags,
        ...(priority !== "none" ? { priority } : {}),
        ...(due ? { due } : {}),
        ...(targetList === null && isSmartView(list) ? {} : { list: targetList }),
        ...(notes.trim() !== "" ? { body: notes.trim() } : {}),
      },
      open ? { onSuccess: (task) => onOpenTask(task.id) } : undefined,
    );
    onDone();
  };
  const onEnter = (event: KeyboardEvent, plainSubmits: boolean) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod && !plainSubmits) return;
    event.preventDefault();
    submit(mod);
  };
  // Closing a picker returns focus to the title, where Enter creates.
  const refocus = (event: Event) => {
    event.preventDefault();
    titleInput.current?.focus();
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-1 px-4 pt-4 pb-2">
        <QuickAddInput
          ref={titleInput}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to type a title.
          autoFocus
          wrap
          draft={draft}
          suggestions={suggestions}
          label="Task title"
          placeholder="Task title"
          className="text-lg font-medium"
          onSubmit={submit}
        />
        <textarea
          aria-label="Notes"
          value={notes}
          rows={1}
          placeholder="Notes"
          className="field-sizing-content max-h-40 min-h-6 resize-none bg-transparent text-base outline-none placeholder:text-muted-foreground/70 md:text-sm"
          onChange={(event) => setNotes(event.target.value)}
          onKeyDown={(event) => onEnter(event, false)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip>
              <StatusIcon category={status?.category} />
              {status?.name ?? "Status"}
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={refocus}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={status?.id ?? ""} onValueChange={setPickedStatus}>
                {snapshot.statuses.map((entry) => (
                  <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                    <StatusIcon category={entry.category} />
                    {entry.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip set={priority !== "none"}>
              <PriorityIcon priority={priority} />
              {priority === "none"
                ? "Priority"
                : PRIORITIES.find((entry) => entry.value === priority)?.label}
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44" onCloseAutoFocus={refocus}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Priority</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={priority}
                onValueChange={(value) => {
                  const picked = MENU_PRIORITIES.find((entry) => entry === value);
                  if (picked === undefined) return;
                  if (parsed.fields.priority) dropTokens((token) => token.kind === "priority");
                  setPickedPriority(picked);
                }}
              >
                {MENU_PRIORITIES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <PriorityIcon priority={value} />
                    {value === "none"
                      ? "No priority"
                      : PRIORITIES.find((entry) => entry.value === value)?.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DuePicker
          value={due}
          onChange={(next) => {
            if (parsed.fields.due) dropTokens((token) => token.kind === "due");
            setPickedDue(next);
          }}
          onCloseAutoFocus={refocus}
        >
          <Chip set={dueLabel !== null} className={cn(dueLabel?.overdue && "text-destructive")}>
            <CalendarIcon />
            {dueLabel ? <span className="font-mono">{dueLabel.label}</span> : "Due date"}
          </Chip>
        </DuePicker>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip set={targetList !== null}>
              <ListGlyph />
              <span className="max-w-40 truncate">{listLabel(snapshot.lists, targetList)}</span>
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-72 w-52 overflow-y-auto"
            onCloseAutoFocus={refocus}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>List</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={targetList ?? ""}
                onValueChange={(value) => {
                  if (parsed.fields.list) dropTokens((token) => token.kind === "list");
                  setPickedList(value === "" ? null : value);
                }}
              >
                <DropdownMenuRadioItem value="">No list</DropdownMenuRadioItem>
                {flatLists(listTree(snapshot.lists)).map(({ list: entry, depth }) => (
                  <DropdownMenuRadioItem
                    key={entry.id}
                    value={entry.id}
                    style={{ paddingLeft: `${0.375 + depth * 0.875}rem` }}
                  >
                    <span className="truncate">{entry.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Chip set={tags.length > 0}>
              <HashIcon />
              {tags.length === 0 ? (
                "Tags"
              ) : (
                <span className="max-w-48 truncate font-mono">{tags.join(" ")}</span>
              )}
            </Chip>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-72 w-48 overflow-y-auto"
            onCloseAutoFocus={refocus}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Tags</DropdownMenuLabel>
              {knownTags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={tags.includes(tag)}
                  className="font-mono text-xs"
                  onSelect={(event) => {
                    // Stay open so several tags can be picked in a row.
                    event.preventDefault();
                    toggleTag(tag);
                  }}
                >
                  #{tag}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuLabel className="font-normal">
                Type <span className="font-mono">#name</span> in the title for a new one
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="More options">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48" onCloseAutoFocus={refocus}>
            <DropdownMenuGroup>
              {LATER.map(({ label, icon: Icon }) => (
                <DropdownMenuItem key={label} disabled>
                  <Icon />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-3 border-t px-4 py-2.5">
        <span className="hidden items-center gap-1.5 font-mono text-xs text-muted-foreground sm:flex">
          <Kbd>↵</Kbd> create
          <span aria-hidden>·</span>
          <Kbd>⌘↵</Kbd> create and open
          <span aria-hidden>·</span>
          <Kbd>esc</Kbd>
        </span>
        <Button size="sm" className="ml-auto" disabled={!ready} onClick={() => submit(false)}>
          Create task
        </Button>
      </div>
    </div>
  );
}

/** A property button in the dialog's row: muted until it holds a value. */
function Chip({
  set = true,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & { set?: boolean; children: ReactNode }) {
  return (
    <Button
      variant="outline"
      size="xs"
      className={cn("bg-transparent", !set && "text-muted-foreground", className)}
      {...props}
    >
      {children}
    </Button>
  );
}
