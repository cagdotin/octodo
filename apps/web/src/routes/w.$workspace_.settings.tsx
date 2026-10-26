import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { WindowDragArea } from "@/components/window-drag-area";
import { snapshotQuery } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";

/** Workspace settings, Linear-style: the app's inset shell with a settings sidebar. */
export const Route = createFileRoute("/w/$workspace_/settings")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(snapshotQuery(params.workspace)),
  component: SettingsLayout,
});

function SettingsLayout() {
  const { workspace } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const navigate = useNavigate();
  useHotkeys({
    escape: () => void navigate({ to: "/w/$workspace", params: { workspace } }),
  });
  if (!snapshot) return null;
  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <WindowDragArea className="h-2" />
      <SettingsSidebar snapshot={snapshot} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
