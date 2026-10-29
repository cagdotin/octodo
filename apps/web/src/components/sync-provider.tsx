import { useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api, keys } from "@/lib/api";
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
      url: api.url("GET /api/events", {}),
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

  const value = useMemo(() => ({ status, retry: () => send({ type: "RETRY" }) }), [status, send]);
  return <SyncContext value={value}>{children}</SyncContext>;
}
