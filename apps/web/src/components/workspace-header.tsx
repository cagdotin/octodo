import type { Priority, Task, WorkspaceSnapshot } from "@tasksmd/core";
import {
  CommandIcon,
  KanbanIcon,
  ListFilterIcon,
  ListIcon,
  PanelRightIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { ListKindIcon, PriorityIcon, tagDot } from "@/components/task-bits";
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
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesktopChrome } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import {
  allTags,
  type DisplayOptions,
  EMPTY_FILTER,
  filterCount,
  listLabel,
  PRIORITIES,
  type Tab,
  TABS,
  type TaskFilter,
} from "@/lib/tasks";

/**
 * The main card's header. In the macOS desktop app it is part of the title bar (a drag region whose
 * middle lines up with the traffic lights), and the sidebar's title bar holds the sidebar toggle;
 * while the sidebar is out of sight the toggle comes here, after the traffic lights.
 */
export function WorkspaceHeader({
  title,
  onNewTask,
  onOpenPalette,
}: {
  title: string;
  onNewTask: () => void;
  onOpenPalette: () => void;
}) {
  const { state, isMobile } = useSidebar();
  const chrome = useDesktopChrome();
  const sidebarHidden = isMobile || state === "collapsed";
  const showTrigger = !chrome.mac || sidebarHidden;

  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-3 select-none md:pl-4",
        "desktop-mac:h-13 desktop-mac:app-drag md:desktop-mac:h-11",
        chrome.windowed && sidebarHidden && "pl-[78px] md:pl-[70px]",
      )}
    >
      {showTrigger && <SidebarTrigger className="-ml-1 text-muted-foreground" />}
      <h1 className="truncate px-1 font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={onOpenPalette}
              aria-label="Command palette"
            >
              <CommandIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Command palette <Kbd>⌘K</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={onNewTask}>
              <PlusIcon data-icon="inline-start" />
              New task
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New task <Kbd>N</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

const ROUND = "rounded-full text-muted-foreground aria-expanded:text-foreground";

/** The row under the header: filter tabs on the left, filter / display / panel buttons right. */
export function ViewBar({
  snapshot,
  tasks,
  tab,
  onTabChange,
  view,
  onViewChange,
  filter,
  onFilterChange,
  display,
  onDisplayChange,
  panelOpen,
  onTogglePanel,
}: {
  snapshot: WorkspaceSnapshot;
  /** Tasks in the current list, before tab and filters, to offer their tags. */
  tasks: ReadonlyArray<Task>;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  view: "list" | "board";
  onViewChange: (view: "list" | "board") => void;
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  display: DisplayOptions;
  onDisplayChange: (display: DisplayOptions) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const count = filterCount(filter);
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-2 md:px-3">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={1}
        value={tab}
        onValueChange={(value) => {
          if (value === "active" || value === "backlog" || value === "all") onTabChange(value);
        }}
        aria-label="Filter tabs"
      >
        {TABS.map((entry) => (
          <ToggleGroupItem
            key={entry.value}
            value={entry.value}
            className="h-7 rounded-full border border-border px-3 text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-accent data-[state=on]:text-foreground"
          >
            {entry.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="ml-auto flex items-center gap-1.5">
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
            <Button variant="outline" size="sm" className={cn(ROUND, "text-foreground")}>
              <ListFilterIcon data-icon="inline-start" />
              {count}
            </Button>
          ) : (
            <Button variant="outline" size="icon-sm" className={ROUND} aria-label="Filter">
              <ListFilterIcon />
            </Button>
          )}
        </FilterMenu>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className={ROUND}
                  aria-label="Display options"
                >
                  <SlidersHorizontalIcon />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Display options</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-64 gap-3 p-3">
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={view}
              onValueChange={(value) => {
                if (value === "list" || value === "board") onViewChange(value);
              }}
              className="w-full"
            >
              <ToggleGroupItem value="list" className="flex-1" aria-label="List view">
                <ListIcon />
                List
              </ToggleGroupItem>
              <ToggleGroupItem value="board" className="flex-1" aria-label="Board view">
                <KanbanIcon />
                Board
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator />
            <div className="flex flex-col gap-2.5">
              <DisplayRow label="Show completed" htmlFor="display-completed">
                <Switch
                  id="display-completed"
                  size="sm"
                  checked={display.showCompleted}
                  onCheckedChange={(checked) =>
                    onDisplayChange({ ...display, showCompleted: checked })
                  }
                />
              </DisplayRow>
              <DisplayRow label="Show archived" htmlFor="display-archived">
                <Switch
                  id="display-archived"
                  size="sm"
                  checked={display.showArchived}
                  onCheckedChange={(checked) =>
                    onDisplayChange({ ...display, showArchived: checked })
                  }
                />
              </DisplayRow>
              <p className="text-xs text-muted-foreground">
                Completed and archived tasks show on the All tab.
              </p>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              className={cn(ROUND, panelOpen && "bg-accent text-foreground")}
              aria-label="Details panel"
              aria-pressed={panelOpen}
              onClick={onTogglePanel}
            >
              <PanelRightIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{panelOpen ? "Close details" : "Open details"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function DisplayRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm">
        {label}
      </label>
      {children}
    </div>
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
              <span className="size-2 rounded-full bg-tag-5" />
              Tag
              <FacetCount count={filter.tags.length} />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-48 overflow-y-auto">
              {tags.map((tag) => (
                <DropdownMenuCheckboxItem
                  key={tag}
                  checked={filter.tags.includes(tag)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(on) =>
                    onChange({ ...filter, tags: toggle(filter.tags, tag, on) })
                  }
                >
                  <span className={cn("size-2 shrink-0 rounded-full", tagDot(tag))} />
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
            <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
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
                    <ListKindIcon kind={list.kind} />
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
