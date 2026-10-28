import type { StatusDefinition } from "../domain.ts";
import { humanize, sortStatuses } from "../layout.ts";

/**
 * The statuses a snapshot shows: the configured ones, then one made up as unstarted for each status
 * only tasks use. `unknown` is the first task to use each made-up one, which a read reports.
 */
export const shownStatuses = <T extends { readonly status: string }>(
  configured: ReadonlyArray<StatusDefinition>,
  tasks: ReadonlyArray<T>,
): { readonly statuses: Array<StatusDefinition>; readonly unknown: Array<T> } => {
  const statuses = [...configured];
  const unknown: Array<T> = [];
  for (const task of tasks) {
    if (statuses.some((known) => known.id === task.status)) continue;
    statuses.push({ id: task.status, name: humanize(task.status), category: "unstarted" });
    unknown.push(task);
  }
  return { statuses: sortStatuses(statuses), unknown };
};

/** Why `order` is not an order of the statuses `shown`, or null when it lists each once. */
export const statusOrderError = (
  shown: ReadonlyArray<StatusDefinition>,
  order: ReadonlyArray<string>,
): string | null => {
  const ids = new Set(shown.map((status) => status.id));
  return order.length === ids.size &&
    new Set(order).size === ids.size &&
    order.every((status) => ids.has(status))
    ? null
    : `The order must list every status once: ${[...ids].join(", ")}`;
};

/**
 * `statuses` in `order` within each category, where `order` lists each of them once. An id in
 * `order` that is not one of them, such as a status only tasks use, is left out.
 */
export const reorderedStatuses = (
  statuses: ReadonlyArray<StatusDefinition>,
  order: ReadonlyArray<string>,
): Array<StatusDefinition> => {
  const byId = new Map(statuses.map((status) => [status.id, status]));
  return sortStatuses(order.flatMap((id) => byId.get(id) ?? []));
};
