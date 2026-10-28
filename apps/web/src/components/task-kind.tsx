import type { Task, WorkspaceSnapshot } from "@octodo/contract";
import { webPlugins, type KindCreate } from "@octodo/plugins/web";

/** The web half of the plugin whose kind the task is, if it has one (decision 0016). */
export const kindWeb = (task: Task) =>
  task.kind === undefined ? undefined : webPlugins[task.kind.id];

/** Whether completing the task logs it and leaves it open instead of closing it. */
export const completesInPlace = (task: Task) => kindWeb(task)?.completesInPlace === true;

/**
 * Whether the panel offers the plain due date. A kind's row shows its own date in the date slot,
 * so a task of a kind gets the control only to clear a `due` it already has (decision 0023).
 */
export const offersDue = (task: Task) => kindWeb(task) === undefined || task.due !== null;

/** A kind a new task can be, by its plugin id. */
export interface CreatableKind {
  readonly id: string;
  readonly create: KindCreate<unknown>;
}

/** The kinds the workspace enables, in config.json's order, that the app can create. */
export const creatableKinds = (snapshot: Pick<WorkspaceSnapshot, "plugins">) =>
  (snapshot.plugins ?? []).flatMap((id): Array<CreatableKind> => {
    const web = webPlugins[id];
    return web === undefined ? [] : [{ id, create: web.create }];
  });

/** The plugin's part of a task row's date slot, or null for a plain task. */
export function KindRow({ task, className }: { task: Task; className?: string | undefined }) {
  const web = kindWeb(task);
  if (web === undefined || task.kind === undefined) return null;
  return <web.Row task={{ ...task, kind: task.kind }} className={className} />;
}

/** The plugin's section of the task panel, or nothing for a plain task. */
export function KindPanel({ workspace, task }: { workspace: string; task: Task }) {
  const web = kindWeb(task);
  if (web === undefined || task.kind === undefined) return null;
  return <web.Panel workspace={workspace} task={{ ...task, kind: task.kind }} />;
}
