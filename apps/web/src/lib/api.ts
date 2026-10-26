import type {
  CreateListInput,
  CreateTaskInput,
  MoveTaskInput,
  Task,
  UpdateTaskInput,
  WorkspaceSnapshot,
} from "@tasksmd/core";
import { createClient } from "@tasksmd/server/client";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { applyMove } from "@/lib/tasks";

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
  session: ["session"] as const,
  workspaces: ["workspaces"] as const,
  snapshot: (ws: string) => ["workspace", ws] as const,
};

export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: async () => {
    const res = await api.session.$get();
    if (res.status === 401) return { paired: false as const };
    if (!res.ok) throw new ApiError(`Server responded ${res.status}`, res.status);
    return { paired: true as const };
  },
  retry: 1,
  staleTime: Infinity,
});

export const workspacesQuery = queryOptions({
  queryKey: keys.workspaces,
  queryFn: () => unwrap(api.workspaces.$get()),
});

export const snapshotQuery = (ws: string) =>
  queryOptions({
    queryKey: keys.snapshot(ws),
    queryFn: () => unwrap(api.workspaces[":ws"].$get({ param: { ws } })),
  });

const onError = (error: Error) => toast.error(error.message);

export const usePair = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => unwrap(api.pair.$post({ json: { token } })),
    onSuccess: () => queryClient.invalidateQueries(),
  });
};

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
    (snapshot, { id, patch }) => mapTask(snapshot, id, (task) => ({ ...task, ...patch })),
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
    (snapshot, id) => ({ ...snapshot, tasks: snapshot.tasks.filter((task) => task.id !== id) }),
  );

export const useCreateList = (ws: string) =>
  useSnapshotMutation(ws, (input: CreateListInput) =>
    unwrap(api.workspaces[":ws"].lists.$post({ param: { ws }, json: input })),
  );
