import type { WorkspaceSnapshot } from "@octodo/contract";
import { Link } from "@tanstack/react-router";
import { SquareCheckBigIcon, SquarePenIcon } from "lucide-react";
import { Count, DiagnosticsButton, WorkspaceSwitcher } from "@/components/app-sidebar";
import { enabledSections, type EnabledSection } from "@/components/section";
import { ITEM } from "@/components/sidebar-lists";
import { SyncIndicator } from "@/components/sync-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@octodo/ui/components/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@octodo/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";

/**
 * Tasks and the sections the workspace enables, for a phone, where the rail is hidden. Renders
 * nothing while the workspace has no section beside Tasks.
 */
export function SectionLinks({
  snapshot,
  active,
  onNavigate,
}: {
  snapshot: WorkspaceSnapshot;
  /** The section shown: a plugin id, or undefined for Tasks. */
  active: string | undefined;
  onNavigate: () => void;
}) {
  const workspace = snapshot.workspace.id;
  const sections = enabledSections(snapshot);
  if (sections.length === 0) return null;
  return (
    <SidebarGroup className="py-1 md:hidden">
      <SidebarGroupContent>
        <SidebarMenu className="gap-px">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={active === undefined} className={ITEM}>
              <Link to="/w/$workspace" params={{ workspace }} onClick={onNavigate}>
                <SquareCheckBigIcon />
                <span>Tasks</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {sections.map(({ id, web }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton asChild isActive={active === id} className={ITEM}>
                <Link
                  to="/w/$workspace/$section"
                  params={{ workspace, section: id }}
                  search={{}}
                  onClick={onNavigate}
                >
                  <web.Icon />
                  <span>{web.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The sidebar while in a plugin's section: the workspace menu and a new-entry button as in Tasks,
 * then the section itself, which is one flat list for now (decision 0027).
 */
export function SectionSidebar({
  snapshot,
  section,
  count,
  onNew,
}: {
  snapshot: WorkspaceSnapshot;
  section: EnabledSection;
  count: number;
  onNew: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => isMobile && setOpenMobile(false);
  const { id, web } = section;

  return (
    <Sidebar className="select-none">
      <SidebarHeader className="flex-row items-center gap-1 pb-1">
        <WorkspaceSwitcher current={snapshot.workspace} />
        <div className="ml-auto flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="rounded-lg bg-background/60 shadow-xs dark:bg-input/30"
                aria-label={`New ${web.noun}`}
                onClick={() => {
                  close();
                  onNew();
                }}
              >
                <SquarePenIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New {web.noun}</TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-1">
        <SectionLinks snapshot={snapshot} active={id} onNavigate={close} />
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive className={ITEM}>
                  <Link
                    to="/w/$workspace/$section"
                    params={{ workspace: snapshot.workspace.id, section: id }}
                    search={{}}
                    onClick={close}
                    draggable={false}
                  >
                    <web.Icon />
                    <span>All {web.label.toLowerCase()}</span>
                  </Link>
                </SidebarMenuButton>
                {count > 0 && <Count value={count} />}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1">
        <SyncIndicator />
        <DiagnosticsButton snapshot={snapshot} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
