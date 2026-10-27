import type { Priority, Task, WorkspaceSnapshot } from "@octodo/core";
import {
  KanbanIcon,
  ListFilterIcon,
  ListIcon,
  MoreHorizontalIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { PageToolbar } from "@/components/app-frame";
import { ListGlyph, PriorityIcon, ViewIcon } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
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
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
  "rounded-lg text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground";

/**
 * The view's part of the toolbar: its name, then a filter button and a "…" menu with the view
 * (list or board) and what to show.
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
}) {
  const count = filterCount(filter);
  return (
    <PageToolbar icon={<ViewIcon list={list} />} title={<h1 className="truncate">{title}</h1>}>
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
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={ROUND} aria-label="View options">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">View</DropdownMenuLabel>
          <div className="flex gap-1 px-1 pb-1">
            {(
              [
                ["list", "List", ListIcon],
                ["board", "Board", KanbanIcon],
              ] as const
            ).map(([value, label, Icon]) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => onViewChange(value)}
                aria-label={`${label} view`}
                className={cn(
                  "flex-1 justify-center text-muted-foreground",
                  view === value && "bg-accent text-foreground",
                )}
              >
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={display.showBacklog}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(on) => onDisplayChange({ ...display, showBacklog: on })}
            >
              Show backlog
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={display.showCompleted}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(on) => onDisplayChange({ ...display, showCompleted: on })}
            >
              Show completed
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={display.showArchived}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(on) => onDisplayChange({ ...display, showArchived: on })}
            >
              Show archived
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageToolbar>
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Filter</DropdownMenuLabel>
        <DropdownMenuGroup>
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
                  onSelect={(event) => event.preventDefault()}
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
                  checked={filter.tags.includes(tag)}
                  onSelect={(event) => event.preventDefault()}
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
                    checked={filter.lists.includes(list.id)}
                    onSelect={(event) => event.preventDefault()}
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
              <DropdownMenuItem onSelect={() => onChange(EMPTY_FILTER)}>
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
