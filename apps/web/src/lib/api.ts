import type {
  CreateListInput,
  CreateTaskInput,
  FixRequest,
  FixResult,
  MoveListInput,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
  WorkspaceSnapshot,
} from "@octodo/contract";
import { createClient } from "@octodo/contract/client";
import type { PresetId } from "@octodo/contract/presets";
import { sortStatuses } from "@octodo/contract/rules";
import type { KindCreate, NewTask } from "@octodo/plugins/web";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { attachmentName, attachmentPath, type Attachments } from "@/lib/attachments";
import { completesInPlace } from "@/components/task-kind";
import { applyListMove, applyMove, withBlockedBy, withoutSubtree } from "@/lib/tasks";

export const api = createClient(typeof window === "undefined" ? "" : window.location.origin);

export const keys = {
  health: ["health"] as const,
  workspaces: ["workspaces"] as const,
  snapshot: (ws: string) => ["workspace", ws] as const,
  connection: ["connection"] as const,
};

/** Whether the server answers at all; the app shows nothing else until it does. */
export const healthQuery = queryOptions({
  queryKey: keys.health,
  queryFn: () => api.request("GET /api/health", {}),
  retry: 1,
  staleTime: Infinity,
});

export const workspacesQuery = queryOptions({
  queryKey: keys.workspaces,
  queryFn: () => api.request("GET /api/workspaces", {}),
});

/** Folders on the server's machine, for choosing a workspace folder; no path means home. */
export const foldersQuery = (path: string | undefined) =>
  queryOptions({
    queryKey: ["folders", path ?? ""] as const,
    queryFn: () => api.request("GET /api/folders", { query: path === undefined ? {} : { path } }),
    retry: false,
    staleTime: 10_000,
  });

/** The server's MCP endpoint, for connecting agents. */
export const connectionQuery = queryOptions({
  queryKey: keys.connection,
  queryFn: () => api.request("GET /api/connection", {}),
  staleTime: Infinity,
});

export const snapshotQuery = (ws: string) =>
  queryOptions({
    queryKey: keys.snapshot(ws),
    queryFn: () => api.request("GET /api/workspaces/:workspace", { params: { workspace: ws } }),
  });

const onError = (error: Error) => toast.error(error.message);

export const useAddWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { root: string; name?: string; key?: string; preset?: PresetId }) =>
      api.request("POST /api/workspaces", { payload: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
  });
};

export const useRemoveWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ws: string) =>
      api.request("DELETE /api/workspaces/:workspace", { params: { workspace: ws } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
    onError,
  });
};

/**
 * Applies `update` to the cached snapshot right away and rolls back if the request fails.
 * Every task mutation refetches the snapshot afterwards, so server-side effects (renamed files,
 * new order keys, `updated` stamps) land without waiting for the SSE event.
 */
const useSnapshotMutation = <V, R>(
  ws: string,
  mutationFn: (vars: V) => Promise<R>,
  update?: (snapshot: WorkspaceSnapshot, vars: V) => WorkspaceSnapshot,
) => {
  const queryClient = useQueryClient();
  const key = keys.snapshot(ws);
  return useMutation({
    mutationFn,
    onMutate: async (vars: V) => {
      if (!update) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WorkspaceSnapshot>(key);
      if (previous) queryClient.setQueryData(key, update(previous, vars));
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      onError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
};

const mapTask = (
  snapshot: WorkspaceSnapshot,
  id: string,
  fn: (task: Task) => Task,
): WorkspaceSnapshot => ({
  ...snapshot,
  tasks: snapshot.tasks.map((task) => (task.id === id ? fn(task) : task)),
});

export const useCreateTask = (ws: string) =>
  useSnapshotMutation(ws, (input: CreateTaskInput) =>
    api.request("POST /api/workspaces/:workspace/tasks", {
      params: { workspace: ws },
      payload: input,
    }),
  );

/** Creates a task of a plugin's kind through the plugin's own operation. */
export const useCreateTaskOfKind = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ kind, task, draft }: { kind: KindCreate<unknown>; task: NewTask; draft: unknown }) =>
      kind.create(ws, task, draft),
  );

export const useUpdateTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      api.request("PATCH /api/workspaces/:workspace/tasks/:id", {
        params: { workspace: ws, id },
        payload: patch,
      }),
    (snapshot, { id, patch: { blocked_by, ...fields } }) => {
      const edited = mapTask(snapshot, id, (task) => ({ ...task, ...fields }));
      return blocked_by === undefined ? edited : withBlockedBy(edited, id, blocked_by);
    },
  );

export const useMoveTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, move }: { id: string; move: MoveTaskInput }) =>
      api.request("POST /api/workspaces/:workspace/tasks/:id/move", {
        params: { workspace: ws, id },
        payload: move,
      }),
    (snapshot, { id, move }) => applyMove(snapshot, id, move, completesInPlace),
  );

export const useDeleteTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    (id: string) =>
      api.request("DELETE /api/workspaces/:workspace/tasks/:id", {
        params: { workspace: ws, id },
      }),
    (snapshot, id) => ({ ...snapshot, tasks: withoutSubtree(snapshot.tasks, id) }),
  );

export const useCreateList = (ws: string) =>
  useSnapshotMutation(ws, (input: CreateListInput) =>
    api.request("POST /api/workspaces/:workspace/lists", {
      params: { workspace: ws },
      payload: input,
    }),
  );

export const useMoveList = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, move }: { id: string; move: MoveListInput }) =>
      api.request("POST /api/workspaces/:workspace/lists/move", {
        params: { workspace: ws },
        payload: { id, ...move },
      }),
    (snapshot, { id, move }) => applyListMove(snapshot, id, move),
  );

/** Toasts the fixes that failed; the snapshot refetch shows the rest. */
const reportFixes = (result: FixResult) => {
  for (const { diagnostic, error } of result.failed)
    toast.error(`Could not fix ${diagnostic.path}`, { description: error });
  return result;
};

export const useFixDiagnostic = (ws: string) =>
  useSnapshotMutation(ws, (request: FixRequest) =>
    api
      .request("POST /api/workspaces/:workspace/diagnostics/fix", {
        params: { workspace: ws },
        payload: request,
      })
      .then(reportFixes),
  );

export const useFixAllDiagnostics = (ws: string) =>
  useSnapshotMutation(ws, () =>
    api
      .request("POST /api/workspaces/:workspace/diagnostics/fix-all", { params: { workspace: ws } })
      .then(reportFixes),
  );

/** The plugins octodo has; the snapshot's `plugins` says which ones a workspace enables. */
export const pluginsQuery = queryOptions({
  queryKey: ["plugins"] as const,
  queryFn: () => api.request("GET /api/plugins", {}),
  staleTime: Infinity,
});

/** Enables or disables a plugin; its tasks change kind once the snapshot is read again. */
export const useSetPlugin = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ plugin, enabled }: { plugin: string; enabled: boolean }) =>
      api.request(
        enabled
          ? "PUT /api/workspaces/:workspace/plugins/:plugin"
          : "DELETE /api/workspaces/:workspace/plugins/:plugin",
        { params: { workspace: ws, plugin } },
      ),
    (snapshot, { plugin, enabled }) => {
      const others = (snapshot.plugins ?? []).filter((id) => id !== plugin);
      return { ...snapshot, plugins: enabled ? [...others, plugin] : others };
    },
  );

/** Saves the order of every status; the server keeps categories in their fixed order. */
export const useReorderStatuses = (ws: string) =>
  useSnapshotMutation(
    ws,
    (order: ReadonlyArray<string>) =>
      api.request("PUT /api/workspaces/:workspace/statuses/order", {
        params: { workspace: ws },
        payload: { order },
      }),
    (snapshot, order) => ({
      ...snapshot,
      statuses: sortStatuses(
        snapshot.statuses.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
      ),
    }),
  );

/** A task's files for the body editor: images load from the server, uploads go under `images/`. */
export const taskAttachments = (workspace: string, id: string): Attachments => ({
  url: (src) => {
    const path = attachmentPath(src);
    return path === null
      ? null
      : api.url("GET /api/workspaces/:workspace/tasks/:id/files/:path", {
          params: { workspace, id, path },
        });
  },
  upload: async (file) => {
    const saved = await api.request("PUT /api/workspaces/:workspace/tasks/:id/files/:path", {
      params: { workspace, id, path: `images/${attachmentName(file)}` },
      payload: file,
    });
    return saved.path;
  },
});
