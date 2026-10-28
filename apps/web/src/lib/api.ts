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
} from "@octodo/core";
import { sortStatuses } from "@octodo/core/layout";
import { createClient } from "@octodo/server/client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyListMove, applyMove, withBlockedBy, withoutSubtree } from "@/lib/tasks";

export const api = createClient(typeof window === "undefined" ? "" : window.location.origin);

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type AnyResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type OkBody<R> = R extends { ok: true; json(): Promise<infer T> } ? T : never;

/** Resolves a Hono client call to its success body, or throws an `ApiError` with the server's message. */
export const unwrap = async <R extends AnyResponse>(request: Promise<R>): Promise<OkBody<R>> => {
  const res = await request;
  if (res.ok) return (await res.json()) as OkBody<R>;
  const body: unknown = await res.json().catch(() => null);
  const message =
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
      ? body.error
      : `Request failed (${res.status})`;
  throw new ApiError(message, res.status);
};

export const keys = {
  health: ["health"] as const,
  workspaces: ["workspaces"] as const,
  snapshot: (ws: string) => ["workspace", ws] as const,
  connection: ["connection"] as const,
};

/** Whether the server answers at all; the app shows nothing else until it does. */
export const healthQuery = queryOptions({
  queryKey: keys.health,
  queryFn: () => unwrap(api.health.$get()),
  retry: 1,
  staleTime: Infinity,
});

export const workspacesQuery = queryOptions({
  queryKey: keys.workspaces,
  queryFn: () => unwrap(api.workspaces.$get()),
});

/** Folders on the server's machine, for choosing a workspace folder; no path means home. */
export const foldersQuery = (path: string | undefined) =>
  queryOptions({
    queryKey: ["folders", path ?? ""] as const,
    queryFn: () => unwrap(api.folders.$get({ query: path === undefined ? {} : { path } })),
    retry: false,
    staleTime: 10_000,
  });

/** The server's MCP endpoint, for connecting agents. */
export const connectionQuery = queryOptions({
  queryKey: keys.connection,
  queryFn: () => unwrap(api.connection.$get()),
  staleTime: Infinity,
});

export const snapshotQuery = (ws: string) =>
  queryOptions({
    queryKey: keys.snapshot(ws),
    queryFn: () => unwrap(api.workspaces[":ws"].$get({ param: { ws } })),
  });

const onError = (error: Error) => toast.error(error.message);

export const useAddWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { root: string; name?: string; key?: string }) =>
      unwrap(api.workspaces.$post({ json: input })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
  });
};

export const useRemoveWorkspace = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ws: string) => unwrap(api.workspaces[":ws"].$delete({ param: { ws } })),
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
    unwrap(api.workspaces[":ws"].tasks.$post({ param: { ws }, json: input })),
  );

export const useUpdateTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      unwrap(api.workspaces[":ws"].tasks[":id"].$patch({ param: { ws, id }, json: patch })),
    (snapshot, { id, patch: { blocked_by, ...fields } }) => {
      const edited = mapTask(snapshot, id, (task) => ({ ...task, ...fields }));
      return blocked_by === undefined ? edited : withBlockedBy(edited, id, blocked_by);
    },
  );

export const useMoveTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, move }: { id: string; move: MoveTaskInput }) =>
      unwrap(api.workspaces[":ws"].tasks[":id"].move.$post({ param: { ws, id }, json: move })),
    (snapshot, { id, move }) => applyMove(snapshot, id, move),
  );

export const useDeleteTask = (ws: string) =>
  useSnapshotMutation(
    ws,
    (id: string) => unwrap(api.workspaces[":ws"].tasks[":id"].$delete({ param: { ws, id } })),
    (snapshot, id) => ({ ...snapshot, tasks: withoutSubtree(snapshot.tasks, id) }),
  );

export const useCreateList = (ws: string) =>
  useSnapshotMutation(ws, (input: CreateListInput) =>
    unwrap(api.workspaces[":ws"].lists.$post({ param: { ws }, json: input })),
  );

export const useMoveList = (ws: string) =>
  useSnapshotMutation(
    ws,
    ({ id, move }: { id: string; move: MoveListInput }) =>
      unwrap(api.workspaces[":ws"].lists.move.$post({ param: { ws }, json: { id, ...move } })),
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
    unwrap(api.workspaces[":ws"].diagnostics.fix.$post({ param: { ws }, json: request })).then(
      reportFixes,
    ),
  );

export const useFixAllDiagnostics = (ws: string) =>
  useSnapshotMutation(ws, () =>
    unwrap(api.workspaces[":ws"].diagnostics["fix-all"].$post({ param: { ws } })).then(reportFixes),
  );

/** Saves the order of every status; the server keeps categories in their fixed order. */
export const useReorderStatuses = (ws: string) =>
  useSnapshotMutation(
    ws,
    (order: ReadonlyArray<string>) =>
      unwrap(api.workspaces[":ws"].statuses.order.$put({ param: { ws }, json: { order } })),
    (snapshot, order) => ({
      ...snapshot,
      statuses: sortStatuses(
        snapshot.statuses.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
      ),
    }),
  );
