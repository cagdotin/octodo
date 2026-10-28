import type { WorkspaceSnapshot } from "@octodo/contract";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { ChevronLeftIcon, PaletteIcon, PlugIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/app-sidebar";
import { SyncIndicator } from "@/components/sync-indicator";
import { StatusIcon } from "@/components/task-bits";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/** Linear-sized nav rows, as in the app's sidebar. */
const ITEM = "h-7 gap-2.5 px-2 text-sidebar-foreground/90 data-active:font-medium";

/** The settings pages of one workspace, for the sidebar and the page titles. */
export const SETTINGS_PAGES = [
  { to: "/w/$workspace/settings", label: "General", icon: <SlidersHorizontalIcon /> },
  {
    to: "/w/$workspace/settings/statuses",
    label: "Statuses",
    icon: <StatusIcon category="started" className="text-current" />,
  },
] as const satisfies ReadonlyArray<{ to: string; label: string; icon: ReactNode }>;

/** Settings for the whole app rather than one workspace. */
export const APP_SETTINGS_PAGES = [
  { to: "/w/$workspace/settings/appearance", label: "Appearance", icon: <PaletteIcon /> },
  { to: "/w/$workspace/settings/connections", label: "Connections", icon: <PlugIcon /> },
] as const satisfies ReadonlyArray<{ to: string; label: string; icon: ReactNode }>;

/**
 * The sidebar while in settings: the same inset shell as the app, with a way back and the settings
 * pages in place of the lists, like Linear's.
 */
export function SettingsSidebar({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const workspace = snapshot.workspace.id;
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar className="select-none">
      <SidebarHeader className="pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className={ITEM}>
              <Link to="/w/$workspace" params={{ workspace }} onClick={close}>
                <ChevronLeftIcon />
                <span>Back to app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="h-7 gap-2 text-sidebar-foreground/60">
            <Avatar label={snapshot.workspace.key} />
            <span className="truncate">{snapshot.workspace.name}</span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <PageLinks pages={SETTINGS_PAGES} workspace={workspace} onNavigate={close} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="py-1">
          <SidebarGroupLabel className="h-7 text-sidebar-foreground/60">App</SidebarGroupLabel>
          <SidebarGroupContent>
            <PageLinks pages={APP_SETTINGS_PAGES} workspace={workspace} onNavigate={close} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1">
        <SyncIndicator />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function PageLinks({
  pages,
  workspace,
  onNavigate,
}: {
  pages: typeof SETTINGS_PAGES | typeof APP_SETTINGS_PAGES;
  workspace: string;
  onNavigate: () => void;
}) {
  const matchRoute = useMatchRoute();
  return (
    <SidebarMenu className="gap-px">
      {pages.map((page) => (
        <SidebarMenuItem key={page.to}>
          <SidebarMenuButton
            asChild
            className={ITEM}
            isActive={matchRoute({ to: page.to, params: { workspace } }) !== false}
          >
            <Link to={page.to} params={{ workspace }} onClick={onNavigate}>
              {page.icon}
              <span>{page.label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
