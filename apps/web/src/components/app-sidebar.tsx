import type { WorkspaceSnapshot } from "@tasksmd/core";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  CheckIcon,
  ChevronDownIcon,
  InboxIcon,
  LayersIcon,
  type LucideIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { AddWorkspaceDialog } from "@/components/add-workspace-dialog";
import { DiagnosticsDialog } from "@/components/diagnostics-dialog";
import { Disclosure } from "@/components/list-view";
import { ListKindIcon } from "@/components/task-bits";
import { NewListDialog } from "@/components/new-list-dialog";
import { SyncIndicator } from "@/components/sync-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { workspacesQuery } from "@/lib/api";
import { isDesktopMac } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import {
  filterTasks,
  isClosedCategory,
  listCounts,
  listTree,
  SMART,
  statusMap,
  type ListNode,
} from "@/lib/tasks";

/** Kinds without a configured label fall back to their folder prefix. */
const KIND_LABELS: Record<string, string> = { p: "Projects", c: "Categories" };
const KIND_ORDER = ["p", "c"];

/** Linear-sized nav rows: 28px tall, 13px text. */
const ITEM = "h-7 gap-2.5 px-2 text-sidebar-foreground/90 data-active:font-medium";

export function AppSidebar({
  snapshot,
  activeList,
  onSearch,
  onNewTask,
}: {
  snapshot: WorkspaceSnapshot;
  activeList: string | undefined;
  onSearch: () => void;
  onNewTask: () => void;
}) {
  const ws = snapshot.workspace.id;
  const { counts, none, open } = listCounts(snapshot);
  const statuses = statusMap(snapshot.statuses);
  const openCount = (list: string) =>
    filterTasks(snapshot.tasks, list).filter(
      (task) => !isClosedCategory(statuses.get(task.status)?.category),
    ).length;
  const [newListOpen, setNewListOpen] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();
  // Picking an entry on a phone should reveal the list behind the sheet.
  const close = () => isMobile && setOpenMobile(false);

  const tree = listTree(snapshot.lists);
  const kinds = [...new Set(tree.map((node) => node.list.kind))].sort(
    (a, b) => (KIND_ORDER.indexOf(a) + 1 || 99) - (KIND_ORDER.indexOf(b) + 1 || 99),
  );

  const entry = (
    list: string | undefined,
    label: string,
    icon: LucideIcon,
    count: number,
  ): ReactNode => {
    const Icon = icon;
    return (
      <SidebarMenuItem key={label}>
        <SidebarMenuButton asChild isActive={activeList === list} className={ITEM}>
          <Link
            to="/w/$workspace"
            params={{ workspace: ws }}
            search={(prev) => ({ ...prev, list, task: undefined })}
            onClick={close}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
        {count > 0 && <Count value={count} />}
      </SidebarMenuItem>
    );
  };

  const renderNode = (node: ListNode, depth: number): ReactNode => {
    const count = counts.get(node.list.id) ?? 0;
    const link = (
      <Link
        to="/w/$workspace"
        params={{ workspace: ws }}
        search={(prev) => ({ ...prev, list: node.list.id, task: undefined })}
        onClick={close}
      >
        <ListKindIcon kind={node.list.kind} />
        <span>{node.list.name}</span>
      </Link>
    );
    const children =
      node.children.length > 0 ? (
        <SidebarMenuSub>
          {node.children.map((child) => renderNode(child, depth + 1))}
        </SidebarMenuSub>
      ) : null;
    if (depth === 0) {
      return (
        <SidebarMenuItem key={node.list.id}>
          <SidebarMenuButton asChild isActive={activeList === node.list.id} className={ITEM}>
            {link}
          </SidebarMenuButton>
          {count > 0 && <Count value={count} />}
          {children}
        </SidebarMenuItem>
      );
    }
    return (
      <SidebarMenuSubItem key={node.list.id}>
        <SidebarMenuSubButton
          asChild
          isActive={activeList === node.list.id}
          className="h-7 text-sidebar-foreground/90 [&>svg]:text-sidebar-foreground/70"
        >
          {link}
        </SidebarMenuSubButton>
        {count > 0 && (
          <span className="pointer-events-none absolute top-1.5 right-2 text-xs text-sidebar-foreground/50 tabular-nums">
            {count}
          </span>
        )}
        {children}
      </SidebarMenuSubItem>
    );
  };

  return (
    <Sidebar variant="inset" className="select-none desktop-mac:pt-0">
      {isDesktopMac && <TitleBar />}
      <SidebarHeader className="flex-row items-center gap-1 pb-1">
        <WorkspaceSwitcher current={snapshot.workspace} />
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-sidebar-foreground/70"
                aria-label="Search"
                onClick={onSearch}
              >
                <SearchIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Search and commands</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="rounded-lg bg-background/60 shadow-xs dark:bg-input/30"
                aria-label="New task"
                onClick={() => {
                  close();
                  onNewTask();
                }}
              >
                <SquarePenIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New task</TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {entry(SMART.all, "All tasks", InboxIcon, open)}
              {entry(SMART.today, "Today", CalendarDaysIcon, openCount(SMART.today))}
              {entry(SMART.upcoming, "Next 7 days", CalendarRangeIcon, openCount(SMART.upcoming))}
              {snapshot.tasks.some((task) => task.list === null) &&
                snapshot.lists.length > 0 &&
                entry(SMART.none, "No list", LayersIcon, none)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {kinds.map((kind) => (
          <Section key={kind} label={KIND_LABELS[kind] ?? kind}>
            {tree.filter((node) => node.list.kind === kind).map((node) => renderNode(node, 0))}
          </Section>
        ))}
        <Section label={kinds.length === 0 ? "Lists" : undefined}>
          <SidebarMenuItem>
            <SidebarMenuButton
              className={cn(ITEM, "text-sidebar-foreground/60")}
              onClick={() => setNewListOpen(true)}
            >
              <PlusIcon />
              <span>New list</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </Section>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1">
        <SyncIndicator />
        <DiagnosticsButton snapshot={snapshot} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </SidebarFooter>
      <NewListDialog
        workspace={ws}
        lists={snapshot.lists}
        open={newListOpen}
        onOpenChange={setNewListOpen}
      />
    </Sidebar>
  );
}

function Count({ value }: { value: number }) {
  return (
    <SidebarMenuBadge className="top-1! font-normal text-sidebar-foreground/50">
      {value}
    </SidebarMenuBadge>
  );
}

/** A sidebar section whose header ("Projects ▾") folds it, like Linear's. */
function Section({ label, children }: { label: string | undefined; children: ReactNode }) {
  if (label === undefined) {
    return (
      <SidebarGroup className="py-0">
        <SidebarMenu className="gap-px">{children}</SidebarMenu>
      </SidebarGroup>
    );
  }
  return (
    <Collapsible defaultOpen className="group/section">
      <SidebarGroup className="py-1">
        <SidebarGroupLabel asChild className="h-7 w-fit gap-1.5 text-sidebar-foreground/60">
          <CollapsibleTrigger>
            {label}
            <Disclosure className="size-2 rotate-90 text-sidebar-foreground/50 group-data-[state=closed]/section:rotate-0" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">{children}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

/**
 * The macOS desktop app's title bar: a drag strip across the sidebar column with the traffic
 * lights at its left (positioned by Electron to match its 52px height) and the sidebar toggle
 * after them. The room for the traffic lights goes away in full screen, where they are hidden.
 */
function TitleBar() {
  return (
    <div
      data-slot="title-bar"
      className="flex h-13 shrink-0 items-center px-2 app-drag windowed-mac:pl-[78px] md:windowed-mac:pl-[70px]"
    >
      <SidebarTrigger />
    </div>
  );
}

function WorkspaceSwitcher({ current }: { current: WorkspaceSnapshot["workspace"] }) {
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 gap-2 px-1.5 font-medium">
            <Avatar label={current.key} />
            <span className="truncate">{current.name}</span>
            <ChevronDownIcon data-icon="inline-end" className="text-sidebar-foreground/60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate">{current.name}</span>
              <span className="truncate font-mono text-xs font-normal text-muted-foreground">
                {current.root}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                title={ws.root}
                onSelect={() =>
                  void navigate({ to: "/w/$workspace", params: { workspace: ws.id }, search: {} })
                }
              >
                <Avatar label={ws.key} />
                <span className="truncate">{ws.name}</span>
                {ws.id === current.id && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => setAddOpen(true)}>
              <PlusIcon />
              Add workspace
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddWorkspaceDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

/** A workspace's little square avatar: the first letters of its id key. */
function Avatar({ label }: { label: string }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-primary text-[10px] leading-none font-semibold text-primary-foreground">
      {label.slice(0, 2)}
    </span>
  );
}

function DiagnosticsButton({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [open, setOpen] = useState(false);
  const count = snapshot.diagnostics.length;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "font-normal",
              count > 0 ? "text-destructive" : "text-sidebar-foreground/60",
            )}
            onClick={() => setOpen(true)}
          >
            <TriangleAlertIcon data-icon="inline-start" />
            {count}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{count === 1 ? "1 file problem" : `${count} file problems`}</TooltipContent>
      </Tooltip>
      <DiagnosticsDialog diagnostics={snapshot.diagnostics} open={open} onOpenChange={setOpen} />
    </>
  );
}
