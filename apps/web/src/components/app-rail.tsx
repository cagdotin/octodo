import { Link, useMatchRoute } from "@tanstack/react-router";
import { CalendarIcon, type LucideIcon, SettingsIcon, SquareCheckBigIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Destination =
  | { label: string; icon: LucideIcon; to: "/w/$workspace" }
  | { label: string; icon: LucideIcon; comingSoon: true };

const DESTINATIONS: ReadonlyArray<Destination> = [
  { label: "Tasks", icon: SquareCheckBigIcon, to: "/w/$workspace" },
  { label: "Calendar", icon: CalendarIcon, comingSoon: true },
];

const RAIL_BUTTON =
  "size-8 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground data-active:bg-background data-active:text-foreground data-active:shadow-card";

/**
 * The app's outermost column, as in ChatGPT's and TickTick's desktop apps: what to look at
 * (tasks, later a calendar) at the top, app settings at the bottom. Wider screens only; a phone
 * reaches the same places through the sidebar sheet.
 */
export function AppRail({ workspace }: { workspace: string }) {
  const matchRoute = useMatchRoute();
  const inSettings =
    matchRoute({ to: "/w/$workspace/settings", params: { workspace }, fuzzy: true }) !== false;

  return (
    <nav
      aria-label="App"
      className="hidden w-(--rail-width) shrink-0 flex-col items-center gap-1 pt-1 pb-2 select-none md:flex"
    >
      {DESTINATIONS.map((destination) =>
        "to" in destination ? (
          <RailLink
            key={destination.label}
            {...destination}
            workspace={workspace}
            active={!inSettings}
          />
        ) : (
          <ComingSoon key={destination.label} {...destination} />
        ),
      )}
      <div className="mt-auto">
        <RailLink
          label="Settings"
          icon={SettingsIcon}
          to="/w/$workspace/settings/appearance"
          workspace={workspace}
          active={inSettings}
        />
      </div>
    </nav>
  );
}

function RailLink({
  label,
  icon: Icon,
  to,
  workspace,
  active,
}: {
  label: string;
  icon: LucideIcon;
  to: "/w/$workspace" | "/w/$workspace/settings/appearance";
  workspace: string;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className={RAIL_BUTTON}
          data-active={active || undefined}
          aria-label={label}
          aria-current={active ? "page" : undefined}
        >
          <Link to={to} params={{ workspace }} draggable={false}>
            <Icon />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ComingSoon({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-disabled
          aria-label={`${label} (coming soon)`}
          className={cn(
            RAIL_BUTTON,
            "cursor-default text-sidebar-foreground/35 hover:bg-transparent hover:text-sidebar-foreground/35",
          )}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label} · coming soon</TooltipContent>
    </Tooltip>
  );
}
