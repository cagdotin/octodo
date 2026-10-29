import type {
  AttachmentContent,
  EntryDay,
  TaskDetail,
  TaskSummary,
  WorkspaceOverview,
  WorkspaceSnapshot,
} from "@octodo/contract";
import {
  catalog,
  inOneWorkspace,
  type Catalog,
  type FileSuccess,
  type OperationName,
} from "@octodo/contract/catalog";
import {
  entriesDueBy,
  isClosedCategory,
  isDueBy,
  localDay,
  type DayContext,
} from "@octodo/contract/rules";
import { Effect, type Schema } from "effect";
import type { Workspace } from "./workspace.ts";
import { Workspaces } from "./workspaces.ts";

export type OperationInput<K extends OperationName> = Catalog[K]["input"]["Type"];

export type OperationSuccess<K extends OperationName> = Catalog[K]["success"] extends FileSuccess
  ? AttachmentContent
  : Catalog[K]["success"] extends Schema.Top
    ? Catalog[K]["success"]["Type"]
    : never;

export type OperationError<K extends OperationName> = Catalog[K]["error"]["Type"];

/**
 * The engine function behind a catalog entry. One that runs in a workspace gets it opened, and
 * its input without the `workspace` field that picked it.
 */
export type Handler<K extends OperationName> = "workspace" extends keyof OperationInput<K>
  ? (
      workspace: Workspace,
      input: Omit<OperationInput<K>, "workspace">,
    ) => Effect.Effect<OperationSuccess<K>, OperationError<K>>
  : (input: OperationInput<K>) => Effect.Effect<OperationSuccess<K>, OperationError<K>, Workspaces>;

const taskRefs = (snapshot: WorkspaceSnapshot, ids: ReadonlyArray<string>) =>
  ids.map((id) => {
    const task = snapshot.tasks.find((candidate) => candidate.id === id);
    return { id, title: task?.title ?? null, status: task?.status ?? null };
  });

const detail = (ws: Workspace, id: string) =>
  Effect.gen(function* () {
    const task = yield* ws.getTask(id);
    const snapshot = yield* ws.snapshot;
    return {
      ...task,
      blockedBy: taskRefs(snapshot, task.blockedBy),
      blocks: taskRefs(snapshot, task.blocks),
      mentions: taskRefs(snapshot, task.mentions),
      mentionedIn: taskRefs(snapshot, task.mentionedIn),
      subtasks: snapshot.tasks
        .filter((candidate) => candidate.parent === id)
        .map(({ id, title, status }) => ({ id, title, status })),
      attachments: yield* ws.attachments(id),
    } satisfies TaskDetail;
  });

const overview = (snapshot: WorkspaceSnapshot): WorkspaceOverview => {
  const count = (predicate: (task: WorkspaceSnapshot["tasks"][number]) => boolean) =>
    snapshot.tasks.filter(predicate).length;
  return {
    workspace: snapshot.workspace,
    statuses: snapshot.statuses.map((status) => ({
      ...status,
      count: count((task) => task.status === status.id),
    })),
    lists: snapshot.lists.map((list) => ({
      ...list,
      count: count((task) => task.list === list.id),
    })),
    diagnostics: snapshot.diagnostics,
    ...(snapshot.plugins === undefined ? {} : { plugins: snapshot.plugins }),
  };
};

const listTasks = (
  snapshot: WorkspaceSnapshot,
  {
    status,
    list,
    parent,
    tag,
    query,
    ready,
    due_by,
    all,
  }: Omit<OperationInput<"list_tasks">, "workspace">,
  days: DayContext,
): Array<TaskSummary | EntryDay> => {
  const closed = new Set(
    snapshot.statuses.filter((known) => isClosedCategory(known.category)).map((known) => known.id),
  );
  const order = new Map(snapshot.statuses.map((known, index) => [known.id, index]));
  const needle = query?.toLowerCase();
  const matches = (item: { readonly title: string; readonly body: string }) =>
    needle === undefined ||
    item.title.toLowerCase().includes(needle) ||
    item.body.toLowerCase().includes(needle);
  const tasks = snapshot.tasks
    .filter(
      (task) =>
        (status === undefined
          ? all === true || !closed.has(task.status)
          : task.status === status) &&
        (list === undefined || task.list === list) &&
        (parent === undefined || task.parent === parent) &&
        (tag === undefined || task.tags.includes(tag)) &&
        (ready !== true || task.ready) &&
        (due_by === undefined || isDueBy(task, due_by.slice(0, 10), days)) &&
        matches(task),
    )
    .toSorted((a, b) => (order.get(a.status) ?? 0) - (order.get(b.status) ?? 0))
    .map(({ id, title, status, list, parent, priority, tags, due, blocked, ready, kind }) => ({
      id,
      title,
      status,
      list,
      parent,
      priority,
      tags,
      due,
      blocked,
      ready,
      ...(kind === undefined ? {} : { kind }),
    }));
  const onlyTasks = [status, list, parent, tag].some((filter) => filter !== undefined) || ready;
  if (due_by === undefined || onlyTasks === true) return tasks;
  return [
    ...tasks,
    ...entriesDueBy((snapshot.entries ?? []).filter(matches), due_by.slice(0, 10), days),
  ];
};

/** Every catalog operation's engine function, by name. */
export const handlers: { readonly [K in OperationName]: Handler<K> } = {
  list_workspaces: () => Workspaces.use((workspaces) => workspaces.list),
  add_workspace: ({ root, ...options }) =>
    Workspaces.use((workspaces) => workspaces.add(root, options)),
  get_workspace: (ws) => Effect.map(ws.snapshot, overview),
  list_tasks: (ws, filters) =>
    Effect.map(ws.snapshot, (snapshot) =>
      listTasks(snapshot, filters, {
        today: localDay(),
        pluginDay: (id) => ws.plugins.find((plugin) => plugin.shared.id === id)?.shared.day,
      }),
    ),
  get_task: (ws, { id }) => detail(ws, id),
  read_attachment: (ws, { id, path }) => ws.readAttachment(id, path),
  create_task: (ws, input) => ws.createTask(input),
  update_task: (ws, { id, ...input }) => Effect.andThen(ws.updateTask(id, input), detail(ws, id)),
  move_task: (ws, { id, ...input }) => ws.moveTask(id, input),
  delete_task: (ws, { id }) => Effect.as(ws.deleteTask(id), { deleted: id }),
  create_list: (ws, input) => ws.createList(input),
  move_list: (ws, { id, ...input }) => ws.moveList(id, input),
  rename_list: (ws, { id, ...input }) => ws.renameList(id, input),
  delete_list: (ws, { id, ...input }) => ws.deleteList(id, input),
  list_diagnostics: (ws) => Effect.map(ws.snapshot, (snapshot) => snapshot.diagnostics),
  fix_diagnostic: (ws, request) => ws.fixDiagnostic(request),
  list_plugins: () =>
    Workspaces.use(({ plugins }) =>
      Effect.succeed(
        plugins.map(({ shared: { id, name, description } }) => ({ id, name, description })),
      ),
    ),
  enable_plugin: (ws, { plugin }) => ws.setPlugin(plugin, true),
  disable_plugin: (ws, { plugin }) => ws.setPlugin(plugin, false),
};

/**
 * Runs the operation `name` on a decoded `input`. `open` turns the input's `workspace` field into
 * a workspace the way the calling surface picks one; an operation without the field skips it.
 */
export const runOperation = <K extends OperationName, E, R>(
  name: K,
  input: OperationInput<K>,
  open: (workspace: string | undefined) => Effect.Effect<Workspace, E, R>,
): Effect.Effect<OperationSuccess<K>, OperationError<K> | E, Workspaces | R> => {
  const handler = handlers[name] as unknown as (
    ...args: Array<unknown>
  ) => Effect.Effect<OperationSuccess<K>, OperationError<K>, Workspaces>;
  if (!inOneWorkspace(catalog[name])) return handler(input);
  const { workspace, ...rest } = input as { readonly workspace?: string };
  return Effect.flatMap(open(workspace), (ws) => handler(ws, rest));
};
