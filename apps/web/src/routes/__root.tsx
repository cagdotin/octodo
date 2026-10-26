import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { RefreshCwIcon, ServerOffIcon } from "lucide-react";
import { PairingGate } from "@/components/pairing-gate";
import { SyncProvider } from "@/components/sync-provider";
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
import { sessionQuery } from "@/lib/api";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  const session = useQuery(sessionQuery);

  if (session.isPending) {
    return (
      <div className="flex h-svh items-center justify-center">
        <WindowDragArea />
        <Spinner />
      </div>
    );
  }

  if (session.isError) {
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
          <Button variant="outline" onClick={() => void session.refetch()}>
            <RefreshCwIcon data-icon="inline-start" />
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!session.data.paired) {
    return (
      <>
        <WindowDragArea />
        <PairingGate />
      </>
    );
  }

  return (
    <SyncProvider>
      <Outlet />
    </SyncProvider>
  );
}
