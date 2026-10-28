import type { PluginInfo } from "@octodo/contract";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { Row, Section, SettingsPage } from "@/components/settings-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@octodo/ui/components/alert-dialog";
import { ItemSeparator } from "@octodo/ui/components/item";
import { Switch } from "@octodo/ui/components/switch";
import { pluginsQuery, snapshotQuery, useSetPlugin } from "@/lib/api";

export const Route = createFileRoute("/w/$workspace_/settings/plugins")({
  loader: ({ context }) => context.queryClient.ensureQueryData(pluginsQuery),
  component: PluginSettings,
});

const count = (n: number) => `${n} task${n === 1 ? "" : "s"}`;

function PluginSettings() {
  const { workspace } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const { data: plugins } = useQuery(pluginsQuery);
  const setPlugin = useSetPlugin(workspace);
  const [disabling, setDisabling] = useState<{ plugin: PluginInfo; tasks: number } | null>(null);
  if (!snapshot || !plugins) return null;
  const enabled = new Set(snapshot.plugins ?? []);
  const tasksOf = (id: string) => snapshot.tasks.filter((task) => task.kind?.id === id).length;

  const toggle = (plugin: PluginInfo, on: boolean) => {
    const tasks = tasksOf(plugin.id);
    if (!on && tasks > 0) setDisabling({ plugin, tasks });
    else setPlugin.mutate({ plugin: plugin.id, enabled: on });
  };

  return (
    <SettingsPage
      title="Plugins"
      description={
        <>
          Plugins add kinds of tasks to this workspace. Which ones it enables lives in{" "}
          <code className="font-mono text-xs">plugins</code> in{" "}
          <code className="font-mono text-xs">config.json</code>.
        </>
      }
    >
      <Section title="Kinds of tasks">
        {plugins.map((plugin, index) => {
          const on = enabled.has(plugin.id);
          const tasks = tasksOf(plugin.id);
          return (
            <Fragment key={plugin.id}>
              {index > 0 && <ItemSeparator className="my-0" />}
              <Row
                title={plugin.name}
                description={
                  <>
                    {plugin.description}
                    {on && tasks > 0 && ` ${count(tasks)} in this workspace.`}
                  </>
                }
              >
                <Switch
                  aria-label={`${on ? "Disable" : "Enable"} ${plugin.name}`}
                  checked={on}
                  onCheckedChange={(checked) => toggle(plugin, checked)}
                />
              </Row>
            </Fragment>
          );
        })}
      </Section>
      <AlertDialog open={disabling !== null} onOpenChange={(open) => !open && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable {disabling?.plugin.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {disabling?.tasks === 1
                ? "Its task keeps everything in its folder, and shows as a plain task until you enable it again."
                : `Its ${count(disabling?.tasks ?? 0)} keep everything in their folders, and show as plain tasks until you enable it again.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                disabling && setPlugin.mutate({ plugin: disabling.plugin.id, enabled: false })
              }
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}
