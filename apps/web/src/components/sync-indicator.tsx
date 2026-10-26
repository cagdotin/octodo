import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSync } from "@/components/sync-provider";
import { cn } from "@/lib/utils";

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
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 px-2 font-mono text-xs font-normal text-sidebar-foreground/60"
          onClick={retry}
          aria-label={LABELS[status]}
        >
          <span className={cn("size-1.5 rounded-full", DOT[status])} />
          {SHORT[status]}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
