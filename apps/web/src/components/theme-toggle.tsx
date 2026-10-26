import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NEXT = { system: "light", light: "dark", dark: "system" } as const;
const LABEL = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = theme === "light" || theme === "dark" ? theme : "system";
  const Icon = current === "light" ? SunIcon : current === "dark" ? MoonIcon : MonitorIcon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setTheme(NEXT[current])}
          aria-label={LABEL[current]}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{LABEL[current]}</TooltipContent>
    </Tooltip>
  );
}
