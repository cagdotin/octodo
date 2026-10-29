import { Button } from "@octodo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { ArrowUpCircleIcon } from "lucide-react";
import { useState } from "react";
import { desktop, useUpdateReady } from "@/lib/desktop";

/** Shown once the desktop app has downloaded a new version; a click restarts into it. */
export function UpdateButton() {
  const version = useUpdateReady();
  const [failure, setFailure] = useState<string>();
  if (!desktop || version === null) return null;
  const restart = () => desktop?.installUpdate().catch((error: Error) => setFailure(error.message));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="xs" className="rounded-full" onClick={() => void restart()}>
            <ArrowUpCircleIcon data-icon="inline-start" />
            Update
          </Button>
        }
      />
      <TooltipContent>{failure ?? `Restart into octodo ${version}`}</TooltipContent>
    </Tooltip>
  );
}
