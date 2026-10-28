import type { Problem } from "@octodo/contract";
import type { TaskFile } from "../tasks/task-file.ts";
import { plainTask, type KindProblem, type Plugin } from "./plugin.ts";

/** The installed plugins config.json's `plugins` names, in its order, and the names it has none for. */
export const enabledPlugins = (
  installed: ReadonlyArray<Plugin>,
  configured: ReadonlyArray<string> = [],
): { readonly enabled: ReadonlyArray<Plugin>; readonly unknown: ReadonlyArray<string> } => {
  const wanted = [...new Set(configured)];
  const find = (id: string) => installed.find((plugin) => plugin.shared.id === id);
  return {
    enabled: wanted.flatMap((id) => find(id) ?? []),
    unknown: wanted.filter((id) => find(id) === undefined),
  };
};

export type KindApplied =
  | { readonly task: TaskFile; readonly plugin: null; readonly problems: ReadonlyArray<Problem> }
  | {
      readonly task: TaskFile;
      /** The plugin whose kind the task is. */
      readonly plugin: Plugin;
      readonly problems: readonly [];
      /** The plugin's files the reader got. */
      readonly files: ReadonlyMap<string, string>;
      readonly kindProblems: ReadonlyArray<KindProblem>;
    };

/**
 * The task as its kind reads it. A `type` naming an enabled plugin has that plugin compute its
 * fields from its keys, which leave `extra`, and its files, which `files` reads. Any other `type`
 * leaves a plain task with an `unknown-kind` problem.
 */
export const applyKind = (
  task: TaskFile,
  frontmatter: Readonly<Record<string, unknown>>,
  files: (plugin: Plugin) => ReadonlyMap<string, string>,
  {
    installed,
    enabled,
  }: { readonly installed: ReadonlyArray<Plugin>; readonly enabled: ReadonlyArray<Plugin> },
): KindApplied => {
  const plain = (detail: string): KindApplied => ({
    task,
    plugin: null,
    problems: [{ kind: "unknown-kind", field: "type", detail }],
  });
  const type = frontmatter["type"];
  if (type === undefined || type === null || type === "" || type === plainTask.id)
    return { task, plugin: null, problems: [] };
  if (typeof type !== "string")
    return plain(`The type ${JSON.stringify(type)} is not a kind's name`);
  const plugin = enabled.find((candidate) => candidate.shared.id === type);
  if (plugin === undefined)
    return plain(
      installed.some((candidate) => candidate.shared.id === type)
        ? `The type ${type} is a plugin this workspace does not enable`
        : `The type ${JSON.stringify(type)} is not a kind octodo has`,
    );
  const own = Object.keys(plugin.shared.keys.fields);
  const keys = Object.fromEntries(
    own.filter((key) => key in frontmatter).map((key) => [key, frontmatter[key]]),
  );
  const texts = files(plugin);
  const { fields, problems } = plugin.read({ task, keys, files: texts });
  return {
    task: {
      ...task,
      extra: Object.fromEntries(Object.entries(task.extra).filter(([key]) => !own.includes(key))),
      kind: { id: plugin.shared.id, fields },
    },
    plugin,
    problems: [],
    files: texts,
    kindProblems: problems,
  };
};
