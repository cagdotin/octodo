import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { RefreshCwIcon, ServerOffIcon } from "lucide-react";
import { SyncProvider } from "@/components/sync-provider";
import { Button } from "@octodo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@octodo/ui/components/empty";
import { Spinner } from "@octodo/ui/components/spinner";
import { WindowDragArea } from "@/components/window-drag-area";
import { healthQuery } from "@/lib/api";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  const health = useQuery(healthQuery);

  if (health.isPending) {
    return (
      <div className="flex h-svh items-center justify-center">
        <WindowDragArea />
        <Spinner />
      </div>
    );
  }

  if (health.isError) {
    return (
      <Empty className="h-svh">
        <WindowDragArea />
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ServerOffIcon />
          </EmptyMedia>
          <EmptyTitle>Can't reach octodo</EmptyTitle>
          <EmptyDescription>
            Make sure the octodo server is running, then try again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void health.refetch()}>
            <RefreshCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <SyncProvider>
      <Outlet />
    </SyncProvider>
  );
}
