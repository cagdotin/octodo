import { Button } from "@octodo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { desktop, useUpdateReady } from "@/lib/desktop";

/** Shown in the rail once the desktop app has downloaded a new version; a click restarts into it. */
export function UpdateButton() {
  const version = useUpdateReady();
  const [failure, setFailure] = useState<string>();
  if (!desktop || version === null) return null;
  const restart = () => desktop?.installUpdate().catch((error: Error) => setFailure(error.message));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon"
            className="size-8 rounded-full border-transparent bg-info text-white shadow-none hover:bg-info/90"
            aria-label={`Update available: ${version}`}
            onClick={() => void restart()}
          >
            <DownloadIcon />
          </Button>
        }
      />
      <TooltipContent side="right">
        {failure ?? (
          <span className="flex flex-col">
            Update available
            <span className="font-mono text-[11px] opacity-70">{version}</span>
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
