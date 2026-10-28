import { Effect } from "effect";
import { join } from "node:path";
import { patchFrontmatter } from "./frontmatter.ts";
import { LIST_FILE, TASKS_SECTION } from "./layout.ts";
import type { Container } from "@octodo/contract/rules";
import { renumbered } from "./place.ts";
import { fileText, type Scan } from "./scan.ts";
import type { Files } from "./storage/files.ts";

export const containerDir = ({ dirs, tree }: Scan, { list, parent }: Container): string =>
  parent !== null
    ? dirs.tasks.get(parent)!
    : list !== null
      ? dirs.lists.get(list)!.dir
      : join(tree.path, TASKS_SECTION);

/** Sorted siblings with distinct, ascending order keys, writing new ones when `renumbered` asks. */
const ensureOrdered = <A extends { readonly order: string }>(
  files: Files,
  scan: Scan,
  items: ReadonlyArray<A>,
  file: (item: A) => string,
) =>
  Effect.gen(function* () {
    const keys = renumbered(items);
    if (keys === null) return items;
    const ordered: Array<A> = [];
    for (const [index, item] of items.entries()) {
      const order = keys[index]!;
      const target = file(item);
      yield* files.writeFile(
        target,
        yield* patchFrontmatter(yield* fileText(scan, target), { order }),
      );
      ordered.push({ ...item, order });
    }
    return ordered;
  });

/** The tasks in `container`, whatever their status, with their order keys. */
export const orderedTasks = (
  files: Files,
  scan: Scan,
  { list, parent }: Container,
  except?: string,
) =>
  ensureOrdered(
    files,
    scan,
    scan.snapshot.tasks.filter(
      (task) => task.list === list && task.parent === parent && task.id !== except,
    ),
    (task) => join(scan.snapshot.workspace.root, task.path),
  );

/**
 * Sibling lists under `parent` with their order keys, which the snapshot leaves out. A list whose
 * `list.md` does not read has no key to place around and is left as it is.
 */
export const orderedLists = (files: Files, scan: Scan, parent: string | null, except?: string) =>
  ensureOrdered(
    files,
    scan,
    scan.snapshot.lists.flatMap((list) => {
      const { dir, order } = scan.dirs.lists.get(list.id)!;
      return list.parent === parent && list.id !== except && order !== null
        ? [{ id: list.id, dir, order }]
        : [];
    }),
    (list) => join(list.dir, LIST_FILE),
  );
