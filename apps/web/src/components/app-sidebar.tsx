import type { WorkspaceSnapshot } from "@octodo/contract";
import { isClosedCategory, isProblem } from "@octodo/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FolderOpenIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toastManager } from "@octodo/ui/components/toast";
import { AddWorkspaceDialog } from "@/components/add-workspace-dialog";
import { DiagnosticsDialog } from "@/components/diagnostics-dialog";
import { COUNT, ITEM, SidebarLists } from "@/components/sidebar-lists";
import { SidebarBottom, SidebarTop } from "@/components/sidebar-chrome";
import { SectionLinks } from "@/components/section-sidebar";
import { SyncIndicator } from "@/components/sync-indicator";
import { ViewIcon } from "@/components/task-bits";
import { sectionDay } from "@/components/section";
import { kindDay } from "@/components/task-kind";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@octodo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@octodo/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { workspacesQuery } from "@/lib/api";
import { desktop } from "@/lib/desktop";
import { useToday } from "@octodo/ui/hooks/use-today";
import { cn } from "@octodo/ui/lib/utils";
import { dueEntries, filterTasks, listCounts, SMART, statusMap } from "@/lib/tasks";

export function AppSidebar({
  snapshot,
  activeList,
}: {
  snapshot: WorkspaceSnapshot;
  activeList: string | undefined;
}) {
  const ws = snapshot.workspace.id;
  const { counts, none, open } = listCounts(snapshot);
  const today = useToday();
  const statuses = statusMap(snapshot.statuses);
  const openCount = (list: string) =>
    filterTasks(snapshot, list, kindDay, today).filter(
      (task) => !isClosedCategory(statuses.get(task.status)?.category),
    ).length + dueEntries(snapshot, list, sectionDay, today).length;
  const { isMobile, setOpenMobile } = useSidebar();
  // Picking an entry on a phone should reveal the list behind the sheet.
  const close = () => isMobile && setOpenMobile(false);

  const entry = (list: string | undefined, label: string, count: number): ReactNode => {
    return (
      <SidebarMenuItem key={label}>
        <SidebarMenuButton
          isActive={activeList === list}
          className={ITEM}
          render={
            <Link
              to="/w/$workspace"
              params={{ workspace: ws }}
              search={(prev) => ({ ...prev, list, task: undefined })}
              onClick={close}
              draggable={false}
            >
              <ViewIcon list={list} />
              <span>{label}</span>
            </Link>
          }
        />
        {count > 0 && <Count value={count} />}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="select-none">
      {/* Phones have no rail, so the workspace menu sits here. */}
      <SidebarTop className="px-2 md:hidden">
        <WorkspaceSwitcher current={snapshot.workspace} trigger="name" />
      </SidebarTop>
      <SidebarContent className="gap-1 pt-1">
        <SectionLinks snapshot={snapshot} active={undefined} onNavigate={close} />
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {entry(SMART.all, "All tasks", open)}
              {entry(SMART.today, "Today", openCount(SMART.today))}
              {entry(SMART.upcoming, "Next 7 days", openCount(SMART.upcoming))}
              {entry(SMART.ready, "Ready", openCount(SMART.ready))}
              {snapshot.tasks.some((task) => task.list === null) &&
                snapshot.lists.length > 0 &&
                entry(SMART.none, "No list", none)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarLists
          snapshot={snapshot}
          activeList={activeList}
          counts={counts}
          onNavigate={close}
        />
      </SidebarContent>
      <SidebarBottom>
        <SyncIndicator />
        <DiagnosticsButton snapshot={snapshot} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </SidebarBottom>
    </Sidebar>
  );
}

export function Count({ value }: { value: number }) {
  return <SidebarMenuBadge className={COUNT}>{value}</SidebarMenuBadge>;
}

/** A sidebar section whose small mono header ("LISTS ▾") folds it. */
/**
 * The workspace menu: the folder for this workspace, then every workspace, one click away. The rail
 * shows it as the workspace's avatar; the sidebar shows its name, on phones where there is no rail.
 */
export function WorkspaceSwitcher({
  current,
  trigger,
}: {
  current: WorkspaceSnapshot["workspace"];
  trigger: "avatar" | "name";
}) {
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            trigger === "avatar" ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg"
                aria-label={`Workspace: ${current.name}`}
                title={current.name}
              >
                <Avatar label={current.key} className="size-6.5 rounded-md text-[11px]" />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="min-w-0 gap-2 px-1.5 font-medium">
                <Avatar label={current.key} />
                <span className="truncate">{current.name}</span>
                <ChevronDownIcon data-icon="inline-end" className="text-sidebar-foreground/60" />
              </Button>
            )
          }
        />
        <DropdownMenuContent
          className="w-60"
          align="start"
          {...(trigger === "avatar" ? { side: "right" as const } : {})}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col gap-0.5 py-1">
              <span className="truncate text-sm font-medium text-foreground">{current.name}</span>
            </DropdownMenuLabel>
            <RevealFolderItem root={current.root} />
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {/* Arrow keys skip this button; the command palette's "Add workspace" covers the keyboard. */}
            <DropdownMenuLabel className="flex items-center justify-between py-0 pr-0.5 text-xs text-muted-foreground">
              Workspaces
              <Button
                variant="ghost"
                size="icon-xs"
                tabIndex={-1}
                aria-label="Add workspace"
                onClick={() => {
                  setMenuOpen(false);
                  setAddOpen(true);
                }}
              >
                <PlusIcon />
              </Button>
            </DropdownMenuLabel>
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                title={ws.root}
                onClick={() =>
                  void navigate({ to: "/w/$workspace", params: { workspace: ws.id }, search: {} })
                }
              >
                <Avatar label={ws.key} />
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.id === current.id && <CheckIcon />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddWorkspaceDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

/** Opens the workspace folder in the desktop app; a browser can only copy its path. */
export function RevealFolderItem({ root }: { root: string }) {
  if (desktop) {
    return (
      <DropdownMenuItem onClick={() => void desktop?.showFolder(root)}>
        <FolderOpenIcon />
        {desktop.platform === "darwin" ? "Show in Finder" : "Show in folder"}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      onClick={() =>
        void navigator.clipboard
          .writeText(root)
          .then(() => toastManager.add({ type: "success", title: "Folder path copied" }))
      }
    >
      <CopyIcon />
      Copy folder path
    </DropdownMenuItem>
  );
}

/** A workspace's little square avatar: the first letters of its id key. */
export function Avatar({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-primary text-[10px] leading-none font-semibold text-primary-foreground",
        className,
      )}
    >
      {label.slice(0, 2)}
    </span>
  );
}

export function DiagnosticsButton({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [open, setOpen] = useState(false);
  const count = snapshot.diagnostics.filter(isProblem).length;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              className={cn(
                "font-normal",
                count > 0 ? "text-destructive" : "text-sidebar-foreground/60",
              )}
              onClick={() => setOpen(true)}
            >
              <TriangleAlertIcon data-icon="inline-start" />
              {count}
            </Button>
          }
        />
        <TooltipContent>{count === 1 ? "1 file problem" : `${count} file problems`}</TooltipContent>
      </Tooltip>
      <DiagnosticsDialog
        workspace={snapshot.workspace.id}
        diagnostics={snapshot.diagnostics}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
