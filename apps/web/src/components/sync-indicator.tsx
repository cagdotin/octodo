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
        <Button variant="ghost" size="icon-sm" onClick={retry} aria-label={LABELS[status]}>
          <span className={cn("size-2 rounded-full", DOT[status])} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
