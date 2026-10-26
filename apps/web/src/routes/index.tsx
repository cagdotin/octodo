import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { FolderOpenIcon } from "lucide-react";
import { AddWorkspaceDialog } from "@/components/add-workspace-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { WindowDragArea } from "@/components/window-drag-area";
import { workspacesQuery } from "@/lib/api";
import { lastWorkspace } from "@/lib/prefs";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const workspaces = useQuery(workspacesQuery);

  if (workspaces.isPending) {
    return (
      <div className="flex h-svh items-center justify-center">
        <WindowDragArea />
        <Spinner />
      </div>
    );
  }

  const list = workspaces.data ?? [];
  const remembered = lastWorkspace.get();
  const target = list.find((ws) => ws.id === remembered) ?? list[0];
  if (target) return <Navigate to="/w/$workspace" params={{ workspace: target.id }} replace />;

  return (
    <Empty className="h-svh">
      <WindowDragArea />
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpenIcon />
        </EmptyMedia>
        <EmptyTitle>No workspaces yet</EmptyTitle>
        <EmptyDescription>
          A workspace is any folder; octodo keeps its tasks as markdown files in a{" "}
          <code>.octodo/</code> folder inside it.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AddWorkspaceDialog trigger={<Button>Add a workspace</Button>} />
      </EmptyContent>
    </Empty>
  );
}
