/** Where a task or list goes among its siblings: plain functions with no Effect code. */
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Task } from "./domain.ts";
import { idNumber } from "./layout.ts";

/** An order key between the neighbours `before` or `after` names, or after the last sibling. */
export const orderBetween = (
  siblings: ReadonlyArray<{ readonly id: string; readonly order: string }>,
  input: { readonly before?: string | undefined; readonly after?: string | undefined },
): string => {
  if (input.before !== undefined) {
    const index = siblings.findIndex((item) => item.id === input.before);
    if (index !== -1)
      return generateKeyBetween(siblings[index - 1]?.order ?? null, siblings[index]!.order);
  }
  if (input.after !== undefined) {
    const index = siblings.findIndex((item) => item.id === input.after);
    if (index !== -1)
      return generateKeyBetween(siblings[index]!.order, siblings[index + 1]?.order ?? null);
  }
  return generateKeyBetween(siblings.at(-1)?.order ?? null, null);
};

/**
 * New keys for sorted siblings when some have none or share one, so a key can be placed between
 * any two; null when their keys are already distinct and ascending.
 */
export const renumbered = (
  siblings: ReadonlyArray<{ readonly order: string }>,
): Array<string> | null =>
  siblings.every(
    (item, index) => item.order !== "" && (index === 0 || siblings[index - 1]!.order < item.order),
  )
    ? null
    : generateNKeysBetween(null, null, siblings.length);

/** Orders by fractional key, keys before no key, then by folder name. */
export const compareOrder = (
  a: { readonly order: string; readonly name: string },
  b: { readonly order: string; readonly name: string },
): number => {
  if (a.order !== b.order) {
    if (a.order === "") return 1;
    if (b.order === "") return -1;
    return a.order < b.order ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
};

/** Orders by fractional key, keys before no key, then by id number in workspace key `key`. */
export const compareTasks =
  (key: string) =>
  (a: Pick<Task, "id" | "order">, b: Pick<Task, "id" | "order">): number => {
    if (a.order !== b.order) {
      if (a.order === "") return 1;
      if (b.order === "") return -1;
      return a.order < b.order ? -1 : 1;
    }
    const byNumber = (idNumber(a.id, key) ?? Infinity) - (idNumber(b.id, key) ?? Infinity);
    return byNumber !== 0 && !Number.isNaN(byNumber)
      ? byNumber
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
  };
