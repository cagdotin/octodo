import type { Priority, Task, WorkspaceSnapshot } from "@octodo/contract";
import { AnimatePresence, LayoutGroup, m } from "motion/react";
import {
  ChevronRightIcon,
  KanbanIcon,
  ListFilterIcon,
  ListIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import { useId, type ReactNode, type ReactElement } from "react";
import { ListGlyph, PriorityIcon, ViewIcon } from "@/components/task-bits";
import { PaneFooter, PaneHeader } from "@octodo/ui/components/pane";
import { useSync } from "@/components/sync-provider";
import { Button } from "@octodo/ui/components/button";
import { Kbd } from "@octodo/ui/components/kbd";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
import { cn } from "@octodo/ui/lib/utils";
import {
  allTags,
  type DisplayOptions,
  EMPTY_FILTER,
  filterCount,
  listLabel,
  PRIORITIES,
  type TaskFilter,
} from "@/lib/tasks";

const ROUND =
  "rounded-md text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground";

const VIEWS = [
  ["list", "List", ListIcon],
  ["board", "Board", KanbanIcon],
] as const;

const spring = { type: "spring", stiffness: 500, damping: 40 } as const;

/**
 * The task view's header, drawn on one hairline across the page: where you are (workspace, then
 * the list), the list or board switch, the filter, what to show, and a new-task button.
 */
export function ViewHeader({
  list,
  title,
  snapshot,
  tasks,
  view,
  onViewChange,
  filter,
  onFilterChange,
  display,
  onDisplayChange,
  onNewTask,
}: {
  list: string | undefined;
  title: string;
  snapshot: WorkspaceSnapshot;
  /** Tasks in the current list, before display options and filters, to offer their tags. */
  tasks: ReadonlyArray<Task>;
  view: "list" | "board";
  onViewChange: (view: "list" | "board") => void;
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  display: DisplayOptions;
  onDisplayChange: (display: DisplayOptions) => void;
  onNewTask: () => void;
}) {
  const count = filterCount(filter);
  const group = useId();
  return (
    <PaneHeader>
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm"
      >
        <span className="hidden truncate text-muted-foreground @md:inline">
          {snapshot.workspace.name}
        </span>
        <ChevronRightIcon
          aria-hidden
          className="hidden size-3.5 shrink-0 text-muted-foreground/60 @md:inline"
        />
        <span className="flex min-w-0 items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
          <ViewIcon list={list} />
          <AnimatePresence initial={false} mode="popLayout">
            <m.h1
              key={title}
              aria-current="page"
              className="truncate font-medium"
              initial={{ opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(2px)" }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {title}
            </m.h1>
          </AnimatePresence>
        </span>
      </nav>

      <LayoutGroup id={group}>
        <fieldset aria-label="Layout" className="flex items-center rounded-md border p-0.5">
          {VIEWS.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              aria-label={`${label} view`}
              onClick={() => onViewChange(value)}
              className={cn(
                "relative flex h-6 cursor-pointer items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                view === value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {view === value && (
                <m.span
                  layoutId="view-switch"
                  transition={spring}
                  className="absolute inset-0 rounded-[calc(var(--radius)*0.5)] bg-accent"
                />
              )}
              <Icon className="relative size-3.5" />
              <span className="relative hidden @lg:inline">{label}</span>
            </button>
          ))}
        </fieldset>
      </LayoutGroup>

      <div className="flex items-center gap-0.5">
        {count > 0 && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => onFilterChange(EMPTY_FILTER)}
          >
            <XIcon data-icon="inline-start" />
            Clear
          </Button>
        )}
        <FilterMenu snapshot={snapshot} tasks={tasks} filter={filter} onChange={onFilterChange}>
          {count > 0 ? (
            <Button variant="ghost" size="sm" className={cn(ROUND, "bg-accent text-foreground")}>
              <ListFilterIcon data-icon="inline-start" />
              {count}
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" className={ROUND} aria-label="Filter">
              <ListFilterIcon />
            </Button>
          )}
        </FilterMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" className={ROUND} aria-label="Display options">
                <MoreHorizontalIcon />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Show</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={display.showBacklog}
                onCheckedChange={(on) => onDisplayChange({ ...display, showBacklog: on })}
              >
                Backlog
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={display.showCompleted}
                onCheckedChange={(on) => onDisplayChange({ ...display, showCompleted: on })}
              >
                Completed
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={display.showArchived}
                onCheckedChange={(on) => onDisplayChange({ ...display, showArchived: on })}
              >
                Archived
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Button size="sm" aria-label="New task" onClick={onNewTask}>
        <PlusIcon data-icon="inline-start" />
        <span className="hidden @md:inline">New task</span>
      </Button>
    </PaneHeader>
  );
}

const toggle = <T,>(values: ReadonlyArray<T>, value: T, on: boolean) =>
  on ? [...values, value] : values.filter((entry) => entry !== value);

function FilterMenu({
  snapshot,
  tasks,
  filter,
  onChange,
  children,
}: {
  snapshot: WorkspaceSnapshot;
  tasks: ReadonlyArray<Task>;
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
  children: ReactNode;
}) {
  const tags = allTags(tasks);
  const chosenTags = new Set(filter.tags);
  const chosenLists = new Set(filter.lists);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={children as ReactElement} />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">Filter</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <PriorityIcon priority="high" />
              Priority
              <FacetCount count={filter.priorities.length} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {PRIORITIES.map((priority) => (
                <DropdownMenuCheckboxItem
                  key={priority.value}
                  checked={filter.priorities.includes(priority.value)}
                  onCheckedChange={(on) =>
                    onChange({
                      ...filter,
                      priorities: toggle<Priority>(filter.priorities, priority.value, on),
                    })
                  }
                >
                  <PriorityIcon priority={priority.value} />
                  {priority.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={tags.length === 0}>
              <TagIcon />
              Tag
              <FacetCount count={filter.tags.length} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-48">
              {tags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={chosenTags.has(tag)}
                  onCheckedChange={(on) =>
                    onChange({ ...filter, tags: toggle(filter.tags, tag, on) })
                  }
                >
                  <span className="truncate">{tag}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={snapshot.lists.length === 0}>
              <ListIcon />
              List
              <FacetCount count={filter.lists.length} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-52">
              {snapshot.lists.map((list) => {
                return (
                  <DropdownMenuCheckboxItem
                    key={list.id}
                    checked={chosenLists.has(list.id)}
                    onCheckedChange={(on) =>
                      onChange({ ...filter, lists: toggle(filter.lists, list.id, on) })
                    }
                  >
                    <ListGlyph />
                    <span className="truncate">{listLabel(snapshot.lists, list.id)}</span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
        {filterCount(filter) > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => onChange(EMPTY_FILTER)}>
                <XIcon />
                Clear filters
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FacetCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="flex-1 text-right text-xs text-muted-foreground tabular-nums">{count}</span>
  );
}

const SYNC = {
  connecting: { dot: "bg-sync-pending animate-pulse", label: "Connecting" },
  live: { dot: "bg-sync-live", label: "Live" },
  reconnecting: { dot: "bg-sync-pending animate-pulse", label: "Reconnecting" },
  offline: { dot: "bg-destructive", label: "Offline" },
} as const;

/** The task view's footer: how many tasks it shows, the connection, and the keys to walk them. */
export function ViewFooter({
  snapshot,
  tasks,
}: {
  snapshot: WorkspaceSnapshot;
  tasks: ReadonlyArray<Task>;
}) {
  const { status, retry } = useSync();
  const started = new Set(
    snapshot.statuses.filter((entry) => entry.category === "started").map((entry) => entry.id),
  );
  const inProgress = tasks.filter((task) => started.has(task.status)).length;
  return (
    <PaneFooter>
      <span className="truncate whitespace-nowrap tabular-nums">
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"} · {inProgress} in progress
      </span>
      <button
        type="button"
        onClick={retry}
        className="ms-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("size-1.5 rounded-full", SYNC[status].dot)} />
        {SYNC[status].label}
      </button>
      <span className="hidden items-center gap-1 @2xl:flex">
        <Kbd className="h-4.5 min-w-4.5 text-[10px]">J</Kbd>
        <Kbd className="h-4.5 min-w-4.5 text-[10px]">K</Kbd>
        to move
        <Kbd className="ms-2 h-4.5 min-w-4.5 text-[10px]">N</Kbd>
        new task
      </span>
    </PaneFooter>
  );
}
