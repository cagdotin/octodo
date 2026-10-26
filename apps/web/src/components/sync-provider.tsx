import { useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { createContext, useContext, type ReactNode } from "react";
import { keys } from "@/lib/api";
import { syncMachine, type SyncStatus } from "@/machines/sync";

interface SyncState {
  status: SyncStatus;
  retry: () => void;
}

const SyncContext = createContext<SyncState>({ status: "connecting", retry: () => {} });

export const useSync = () => useContext(SyncContext);

/** Runs the live-sync machine for the signed-in app and invalidates queries on file changes. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [snapshot, send] = useMachine(syncMachine, {
    input: {
      url: "/api/events",
      onChange: (workspace) => {
        if (workspace === null) void queryClient.invalidateQueries();
        else void queryClient.invalidateQueries({ queryKey: keys.snapshot(workspace) });
      },
    },
  });

  const status: SyncStatus = snapshot.matches({ connected: "live" })
    ? "live"
    : snapshot.matches("reconnecting")
      ? "reconnecting"
      : snapshot.matches("offline")
        ? "offline"
        : "connecting";

  return (
    <SyncContext value={{ status, retry: () => send({ type: "RETRY" }) }}>{children}</SyncContext>
  );
}
