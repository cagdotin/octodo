import { Effect } from "effect";
import { basename, dirname, sep } from "node:path";
import { isHidden } from "./bookkeeping.ts";

/**
 * What the tree reader read from each path, kept between reads until a change at that path, under
 * it or directly inside it forgets it: a folder's listing and the kind of folder it is both depend
 * on the entries it holds.
 */
export interface Cache {
  /**
   * `read`'s value for `aspect` of `path`, read once and then kept until the path changes, when
   * `keep` says it is what stays on disk until then.
   */
  readonly read: <A, E, R>(
    path: string,
    aspect: string,
    read: Effect.Effect<A, E, R>,
    keep?: (value: A) => boolean,
  ) => Effect.Effect<A, E, R>;
  readonly changed: (path: string) => void;
  readonly clear: () => void;
  /**
   * Counts the changes so far. Whatever was read while it moved may hold what was there before,
   * so it is not kept.
   */
  readonly version: () => number;
}

export const makeCache = (): Cache => {
  const byPath = new Map<string, Map<string, unknown>>();
  let changes = 0;
  return {
    version: () => changes,
    read: (path, aspect, read, keep = () => true) =>
      Effect.suspend(() => {
        const aspects = byPath.get(path);
        if (aspects?.has(aspect) === true) return Effect.succeed(aspects.get(aspect) as never);
        const before = changes;
        return Effect.map(read, (value) => {
          if (changes !== before || !keep(value)) return value;
          const kept = byPath.get(path);
          if (kept === undefined) byPath.set(path, new Map([[aspect, value]]));
          else kept.set(aspect, value);
          return value;
        });
      }),
    changed: (path) => {
      if (isHidden(basename(path))) return;
      changes++;
      byPath.delete(path);
      byPath.delete(dirname(path));
      const inside = path.endsWith(sep) ? path : `${path}${sep}`;
      for (const key of byPath.keys()) if (key.startsWith(inside)) byPath.delete(key);
    },
    clear: () => {
      changes++;
      byPath.clear();
    },
  };
};
