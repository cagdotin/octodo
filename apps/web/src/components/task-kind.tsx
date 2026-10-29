import type { Task } from "@octodo/contract";
import { kindWeb } from "@/lib/task-kind";

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
