import type { Entry, WorkspaceSnapshot } from "@octodo/contract";
import { Link } from "@tanstack/react-router";
import { type LucideIcon, SquareCheckBigIcon } from "lucide-react";
import { Count, DiagnosticsButton, WorkspaceSwitcher } from "@/components/app-sidebar";
import { enabledSections, type EnabledSection } from "@/components/section";
import { ITEM } from "@/components/sidebar-lists";
import { SidebarBottom, SidebarTop } from "@/components/sidebar-chrome";
import { SyncIndicator } from "@/components/sync-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@octodo/ui/components/sidebar";
import { useToday } from "@octodo/ui/hooks/use-today";

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
            <SidebarMenuButton
              isActive={active === undefined}
              className={ITEM}
              render={
                <Link to="/w/$workspace" params={{ workspace }} onClick={onNavigate}>
                  <SquareCheckBigIcon />
                  <span>Tasks</span>
                </Link>
              }
            />
          </SidebarMenuItem>
          {sections.map(({ id, web }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton
                isActive={active === id}
                className={ITEM}
                render={
                  <Link
                    to="/w/$workspace/$section"
                    params={{ workspace, section: id }}
                    search={{}}
                    onClick={onNavigate}
                  >
                    <web.Icon />
                    <span>{web.label}</span>
                  </Link>
                }
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The sidebar while in a plugin's section: all its entries, then the views its plugin names, each
 * with its count, as Tasks lists All tasks, Today and Ready.
 */
export function SectionSidebar({
  snapshot,
  section,
  entries,
  active,
}: {
  snapshot: WorkspaceSnapshot;
  section: EnabledSection;
  entries: ReadonlyArray<Entry>;
  /** The view shown; undefined for all entries. */
  active: string | undefined;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => isMobile && setOpenMobile(false);
  const { id, web } = section;
  const today = useToday();
  const link = (view: string | undefined, label: string, Icon: LucideIcon, count: number) => (
    <SidebarMenuItem key={view ?? "all"}>
      <SidebarMenuButton
        isActive={active === view}
        className={ITEM}
        render={
          <Link
            to="/w/$workspace/$section"
            params={{ workspace: snapshot.workspace.id, section: id }}
            search={view === undefined ? {} : { show: view }}
            onClick={close}
            draggable={false}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        }
      />
      {count > 0 && <Count value={count} />}
    </SidebarMenuItem>
  );

  return (
    <Sidebar className="select-none">
      {/* Phones have no rail, so the workspace menu sits here. */}
      <SidebarTop className="px-2 md:hidden">
        <WorkspaceSwitcher current={snapshot.workspace} trigger="name" />
      </SidebarTop>
      <SidebarContent className="gap-1 pt-1">
        <SectionLinks snapshot={snapshot} active={id} onNavigate={close} />
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {link(undefined, `All ${web.label.toLowerCase()}`, web.Icon, entries.length)}
              {web.views.map((view) =>
                link(
                  view.id,
                  view.label,
                  view.Icon,
                  entries.filter((entry) => view.matches(entry.fields, today)).length,
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
