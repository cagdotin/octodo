import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useMatchRoute } from "@tanstack/react-router";
import { type LucideIcon, SettingsIcon, SquareCheckBigIcon } from "lucide-react";
import { WorkspaceSwitcher } from "@/components/app-sidebar";
import { enabledSections } from "@/components/section";
import { UpdateButton } from "@/components/update-button";
import { Button } from "@octodo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { snapshotQuery } from "@/lib/api";

const RAIL_BUTTON =
  "size-8 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground data-active:bg-background data-active:text-foreground data-active:shadow-card";

/**
 * The app's outermost column, as in ChatGPT's and TickTick's desktop apps: the workspace switcher
 * on top, then the sections, Tasks first and then each one the workspace enables (decision 0027),
 * the workspace's settings at the bottom, with the desktop app's update above them once one is ready. Wider screens only; a phone reaches the same places through the sidebar sheet.
 */
export function AppRail({ workspace }: { workspace: string }) {
  const matchRoute = useMatchRoute();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const inSettings =
    matchRoute({ to: "/w/$workspace/settings", params: { workspace }, fuzzy: true }) !== false;
  const sections = snapshot === undefined ? [] : enabledSections(snapshot);
  const inSection = (section: string) =>
    matchRoute({ to: "/w/$workspace/$section", params: { workspace, section } }) !== false;
  const inTasks = !inSettings && !sections.some((section) => inSection(section.id));

  return (
    <nav
      aria-label="App"
      className="hidden w-(--rail-width) shrink-0 flex-col items-center gap-1 pt-1 pb-2 select-none md:flex"
    >
      {snapshot && <WorkspaceSwitcher current={snapshot.workspace} trigger="avatar" />}
      <div className="my-1 h-px w-5 bg-sidebar-border" />
      <RailLink
        label="Tasks"
        icon={SquareCheckBigIcon}
        link={{ to: "/w/$workspace", params: { workspace } }}
        active={inTasks}
      />
      {sections.map(({ id, web }) => (
        <RailLink
          key={id}
          label={web.label}
          icon={web.Icon}
          link={{ to: "/w/$workspace/$section", params: { workspace, section: id } }}
          active={inSection(id)}
        />
      ))}
      <div className="mt-auto flex flex-col items-center gap-2">
        <UpdateButton />
        <RailLink
          label="Settings"
          icon={SettingsIcon}
          link={{ to: "/w/$workspace/settings", params: { workspace } }}
          active={inSettings}
        />
      </div>
    </nav>
  );
}

function RailLink({
  label,
  icon: Icon,
  link,
  active,
}: {
  label: string;
  icon: LucideIcon;
  link: LinkProps;
  active: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={RAIL_BUTTON}
            data-active={active || undefined}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            render={
              <Link {...link} draggable={false}>
                <Icon />
              </Link>
            }
          />
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
