import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { AppFrame } from "@/components/app-frame";
import { SettingsSidebar } from "@/components/settings-sidebar";
import { SidebarInset } from "@octodo/ui/components/sidebar";
import { snapshotQuery } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";

/** Workspace settings: the app's frame with a settings sidebar. */
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
    <AppFrame workspace={workspace}>
      <SettingsSidebar snapshot={snapshot} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <Outlet />
      </SidebarInset>
    </AppFrame>
  );
}
