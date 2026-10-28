import type {
  List,
  Priority,
  StatusCategory,
  StatusDefinition,
  Task,
  WorkspaceSnapshot,
} from "@octodo/contract";
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  FolderIcon,
  InboxIcon,
  LayersIcon,
  ListChecksIcon,
  LockOpenIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { KindRow, kindWeb } from "@/components/task-kind";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMoveTask, useUpdateTask } from "@/lib/api";
import { checklistProgress } from "@/lib/checklist";
import { cn } from "@/lib/utils";
import { createdLabel, dueInfo, listLabel, PRIORITIES, PRIORITY_TEXT, SMART } from "@/lib/tasks";

/* ---------------------------------------------------------------------------------------------- */
/* Icons                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const STATUS_TEXT: Record<StatusCategory, string> = {
  backlog: "text-status-backlog",
  unstarted: "text-status-unstarted",
  started: "text-status-started",
  completed: "text-status-completed",
  canceled: "text-status-canceled",
  archived: "text-status-canceled",
};

/** Linear-style status glyph, drawn per category. */
export function StatusIcon({
  category,
  className,
}: {
  category: StatusCategory | undefined;
  className?: string;
}) {
  const cat = category ?? "unstarted";
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={cn("size-3.5 shrink-0", STATUS_TEXT[cat], className)}
      fill="none"
    >
      {cat === "backlog" && (
        <circle
          cx="7"
          cy="7"
          r="6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="1.4 1.74"
        />
      )}
      {cat === "unstarted" && (
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      )}
      {cat === "started" && (
        <>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 3.5A3.5 3.5 0 0 1 7 10.5Z" fill="currentColor" />
        </>
      )}
      {cat === "completed" && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="M4.2 7.2 6.1 9l3.7-3.9"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {(cat === "canceled" || cat === "archived") && (
        <>
          <circle cx="7" cy="7" r="7" fill="currentColor" />
          <path
            d="m4.9 4.9 4.2 4.2m0-4.2L4.9 9.1"
            stroke="var(--background)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

const BARS: Record<Exclude<Priority, "urgent">, number> = { none: 0, low: 1, medium: 2, high: 3 };

/** Linear-style priority glyph: urgent is a filled square with "!", the rest signal bars. */
export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  const label = PRIORITIES.find((entry) => entry.value === priority)?.label;
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" className={cn("size-3.5 shrink-0", PRIORITY_TEXT.urgent, className)}>
        <title>{`${label} priority`}</title>
        <rect width="14" height="14" rx="3" fill="currentColor" />
        <rect x="6.25" y="3" width="1.5" height="5" rx="0.75" fill="var(--background)" />
        <rect x="6.25" y="9.5" width="1.5" height="1.5" rx="0.75" fill="var(--background)" />
      </svg>
    );
  }
  const filled = BARS[priority];
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn("size-3.5 shrink-0", PRIORITY_TEXT[priority], className)}
    >
      <title>{priority === "none" ? "No priority" : `${label} priority`}</title>
      {priority === "none"
        ? [1, 5.5, 10].map((x) => (
            <rect key={x} x={x} y="6.25" width="3" height="1.5" rx="0.75" fill="currentColor" />
          ))
        : [6, 9, 12].map((height, i) => (
            <rect
              key={height}
              x={1 + i * 4.5}
              y={13 - height}
              width="3"
              height={height}
              rx="1"
              fill="currentColor"
              opacity={i < filled ? 1 : 0.3}
            />
          ))}
    </svg>
  );
}

/** The icon every list gets: a list is a folder on disk. */
export function ListGlyph({ className }: { className?: string }) {
  return <FolderIcon className={className} />;
}

/** The icon of a view: a smart view's own, or the list glyph. */
export function ViewIcon({ list }: { list: string | undefined }) {
  switch (list) {
    case SMART.all:
      return <InboxIcon />;
    case SMART.today:
      return <CalendarDaysIcon />;
    case SMART.upcoming:
      return <CalendarRangeIcon />;
    case SMART.none:
      return <LayersIcon />;
    case SMART.ready:
      return <LockOpenIcon />;
    default:
      return <ListGlyph />;
  }
}

/* ---------------------------------------------------------------------------------------------- */
/* Chips                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-[22px] max-w-44 gap-1.5 rounded-full px-2 font-normal text-muted-foreground",
        className,
      )}
    >
      {children}
    </Badge>
  );
}

/** A tag as it reads in the file's frontmatter, set like a markdown hashtag. */
export function TagChip({ tag }: { tag: string }) {
  return (
    <span className="max-w-36 shrink-0 truncate font-mono text-xs text-muted-foreground">
      #{tag}
    </span>
  );
}

export function TagChips({ tags, max = 2 }: { tags: ReadonlyArray<string>; max?: number }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex min-w-0 shrink items-center gap-2 overflow-hidden">
      {tags.slice(0, max).map((tag) => (
        <TagChip key={tag} tag={tag} />
      ))}
      {tags.length > max && (
        <span className="font-mono text-xs text-muted-foreground">+{tags.length - max}</span>
      )}
    </span>
  );
}

/** A list as the folder it is on disk (`garden/seeds/`), with its display name on hover. */
export function ListChip({ lists, list }: { lists: ReadonlyArray<List>; list: string | null }) {
  if (list === null) return null;
  return (
    <span
      title={listLabel(lists, list)}
      className="max-w-44 shrink-0 truncate font-mono text-xs text-muted-foreground"
    >
      {list}/
    </span>
  );
}

/** The row's date: the due date when set (red when overdue), otherwise when it was created. */
/** "2/5" for a body with a checklist, nothing otherwise. */
export function ChecklistCount({ body, className }: { body: string; className?: string }) {
  const progress = checklistProgress(body);
  if (progress === null) return null;
  const { done, total } = progress;
  return (
    <span
      title={`${done} of ${total} checklist items done`}
      className={cn(
        "flex shrink-0 items-center gap-1 font-mono text-xs text-muted-foreground",
        className,
      )}
    >
      <ListChecksIcon className="size-3.5" />
      {done}/{total}
    </span>
  );
}

export function TaskDate({ task, className }: { task: Task; className?: string }) {
  if (kindWeb(task) !== undefined) return <KindRow task={task} className={className} />;
  const due = dueInfo(task.due);
  if (due) {
    return (
      <span
        title={`Due ${task.due}`}
        className={cn(
          "shrink-0 font-mono text-xs",
          due.overdue ? "text-destructive" : due.today ? "text-foreground" : "text-foreground/80",
          className,
        )}
      >
        {due.label}
      </span>
    );
  }
  const created = createdLabel(task.created);
  if (!created) return null;
  return (
    <span
      title={created.title}
      className={cn("shrink-0 font-mono text-xs text-muted-foreground", className)}
    >
      {created.label}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Menus                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export const categoryOf = (snapshot: WorkspaceSnapshot, task: Task) =>
  snapshot.statuses.find((status) => status.id === task.status)?.category;

export const isDone = (status: StatusDefinition | undefined) =>
  status?.category === "completed" || status?.category === "canceled";

const iconButton =
  "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-accent";

/**
 * Keeps clicks and keys on a menu button inside a row or a draggable card from reaching it (the
 * row's link, the board's keyboard drag).
 */
const isolate = {
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onTouchStart: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

/** The status glyph as a button that opens a status picker; it replaces completion checkboxes. */
export function StatusMenu({
  workspace,
  snapshot,
  task,
  className,
  children,
}: {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  task: Task;
  className?: string;
  /** A custom trigger; defaults to the bare status glyph. */
  children?: ReactNode;
}) {
  const move = useMoveTask(workspace);
  const current = snapshot.statuses.find((status) => status.id === task.status);
  return (
    <DropdownMenu>
      {children ? (
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          className={cn(iconButton, className)}
          aria-label={`Status: ${current?.name ?? task.status}`}
          {...isolate}
        >
          <StatusIcon category={current?.category} />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Status</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={task.status}
            onValueChange={(status) => {
              if (status !== task.status) move.mutate({ id: task.id, move: { status } });
            }}
          >
            {snapshot.statuses.map((status) => (
              <DropdownMenuRadioItem key={status.id} value={status.id}>
                <StatusIcon category={status.category} />
                {status.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The priority glyph as a button that opens a priority picker. */
export function PriorityMenu({
  workspace,
  task,
  className,
  children,
}: {
  workspace: string;
  task: Task;
  className?: string;
  children?: ReactNode;
}) {
  const update = useUpdateTask(workspace);
  return (
    <DropdownMenu>
      {children ? (
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          className={cn(iconButton, className)}
          aria-label={`Priority: ${task.priority}`}
          {...isolate}
        >
          <PriorityIcon priority={task.priority} />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Priority</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={task.priority}
            onValueChange={(value) => {
              const priority = PRIORITIES.find((entry) => entry.value === value)?.value;
              if (priority && priority !== task.priority)
                update.mutate({ id: task.id, patch: { priority } });
            }}
          >
            {PRIORITIES.map((priority) => (
              <DropdownMenuRadioItem key={priority.value} value={priority.value}>
                <PriorityIcon priority={priority.value} />
                {priority.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
