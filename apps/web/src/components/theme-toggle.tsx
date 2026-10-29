import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@octodo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" onClick={() => setTheme(next)} aria-label={label}>
            {resolvedTheme === "dark" ? <MoonIcon /> : <SunIcon />}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
