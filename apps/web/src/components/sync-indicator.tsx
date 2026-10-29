import { Button } from "@octodo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { useSync } from "@/components/sync-provider";
import { cn } from "@octodo/ui/lib/utils";

const LABELS = {
  connecting: "Connecting…",
  live: "Live: changes on disk appear instantly",
  reconnecting: "Reconnecting…",
  offline: "Offline: click to retry",
} as const;

/** Short state next to the dot; the files never leave this machine, whatever the connection. */
const SHORT = {
  connecting: "local · connecting",
  live: "local · live",
  reconnecting: "local · reconnecting",
  offline: "local · offline",
} as const;

const DOT = {
  connecting: "bg-sync-pending animate-pulse",
  live: "bg-sync-live",
  reconnecting: "bg-sync-pending animate-pulse",
  offline: "bg-destructive",
} as const;

export function SyncIndicator() {
  const { status, retry } = useSync();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="gap-1.5 font-normal text-sidebar-foreground/60"
            onClick={retry}
            aria-label={LABELS[status]}
          >
            <span className={cn("size-1.5 rounded-full", DOT[status])} />
            {SHORT[status]}
          </Button>
        }
      />
      <TooltipContent>{LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
