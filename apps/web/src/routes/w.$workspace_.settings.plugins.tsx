import type { PluginInfo, WorkspaceSnapshot } from "@octodo/contract";
import { webPlugins, webSections } from "@octodo/plugins/web";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BlocksIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Section, SettingsPage } from "@/components/settings-page";
import { Button } from "@octodo/ui/components/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@octodo/ui/components/alert-dialog";
import { Badge } from "@octodo/ui/components/badge";
import { Switch } from "@octodo/ui/components/switch";
import { cn } from "@octodo/ui/lib/utils";
import { pluginsQuery, snapshotQuery, useSetPlugin } from "@/lib/api";

export const Route = createFileRoute("/w/$workspace_/settings/plugins")({
  loader: ({ context }) => context.queryClient.ensureQueryData(pluginsQuery),
  component: PluginSettings,
});

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What a plugin adds, as its card shows it: a section of its own, or a kind of task. */
function describe(snapshot: WorkspaceSnapshot, id: string) {
  const section = webSections[id];
  if (section) {
    const entries = (snapshot.entries ?? []).filter((entry) => entry.section === id).length;
    return { Icon: section.Icon, adds: "Section", tasks: 0, used: plural(entries, section.noun) };
  }
  const tasks = snapshot.tasks.filter((task) => task.kind?.id === id).length;
  const Icon: LucideIcon = webPlugins[id]?.create.Icon ?? BlocksIcon;
  return { Icon, adds: "Task kind", tasks, used: plural(tasks, "task") };
}

function PluginSettings() {
  const { workspace } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const { data: plugins } = useQuery(pluginsQuery);
  const setPlugin = useSetPlugin(workspace);
  const [disabling, setDisabling] = useState<{ plugin: PluginInfo; tasks: number } | null>(null);
  if (!snapshot || !plugins) return null;
  const enabled = new Set(snapshot.plugins ?? []);

  const toggle = (plugin: PluginInfo, on: boolean) => {
    const { tasks } = describe(snapshot, plugin.id);
    if (!on && tasks > 0) setDisabling({ plugin, tasks });
    else setPlugin.mutate({ plugin: plugin.id, enabled: on });
  };

  return (
    <SettingsPage
      title="Plugins"
      description="Plugins add kinds of tasks and sections to this workspace."
    >
      <Section
        title="Available"
        description={
          <>
            Which ones this workspace enables lives in{" "}
            <code className="font-mono text-[11px]">plugins</code> in{" "}
            <code className="font-mono text-[11px]">config.json</code>.
          </>
        }
        action={
          <span className="text-sm text-muted-foreground tabular-nums">
            {enabled.size} of {plugins.length} on
          </span>
        }
      >
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {plugins.map((plugin) => {
            const on = enabled.has(plugin.id);
            const { Icon, adds, used } = describe(snapshot, plugin.id);
            return (
              <li key={plugin.id}>
                <label
                  className={cn(
                    "flex h-full cursor-pointer items-start gap-3 rounded-xl border bg-card p-3.5 transition-[border-color,scale] duration-150 ease-out active:scale-[0.985] [@media(hover:hover)]:hover:border-foreground/16",
                    on && "border-foreground/16",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex h-5 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{plugin.name}</span>
                      <Badge size="sm" variant="outline">
                        {adds}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-pretty text-muted-foreground">
                      {plugin.description}
                    </span>
                    {on && (
                      <span className="mt-2 block text-xs text-muted-foreground tabular-nums">
                        {used} in this workspace
                      </span>
                    )}
                  </span>
                  <Switch
                    className="mt-0.5"
                    aria-label={`${on ? "Disable" : "Enable"} ${plugin.name}`}
                    checked={on}
                    onCheckedChange={(checked) => toggle(plugin, checked)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </Section>
      <AlertDialog open={disabling !== null} onOpenChange={(open) => !open && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {disabling?.plugin.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {disabling?.tasks === 1
                ? "Its task keeps everything in its folder, and shows as a plain task until you enable it again."
                : `Its ${plural(disabling?.tasks ?? 0, "task")} keep everything in their folders, and show as plain tasks until you enable it again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button />}
              onClick={() =>
                disabling && setPlugin.mutate({ plugin: disabling.plugin.id, enabled: false })
              }
            >
              Disable
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
