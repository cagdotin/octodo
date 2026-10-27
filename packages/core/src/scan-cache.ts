import { Effect, type FileSystem } from "effect";
import { basename, dirname, sep } from "node:path";
import { tempName } from "./files.ts";

/**
 * What scans read from each path, kept between scans until a change at that path, under it or
 * directly inside it forgets it: a folder's listing and the kind of folder it is both depend on
 * the entries it holds.
 */
export interface ScanCache {
  /** `read`'s value for `aspect` of `path`, read once and then kept until the path changes. */
  readonly read: <A, E, R>(
    path: string,
    aspect: string,
    read: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly changed: (path: string) => void;
  readonly clear: () => void;
  /**
   * Counts the changes so far. Whatever was read while it moved may hold what was there before,
   * so it is not kept.
   */
  readonly version: () => number;
}

/** Dot names a scan reads: every other one (claims, temporary files) is invisible to it. */
const SCANNED_DOT_NAMES = new Set([tempName.pendingId]);

const invisibleToScans = (path: string) => {
  const name = basename(path);
  return name.startsWith(".") && !SCANNED_DOT_NAMES.has(name);
};

export const makeScanCache = (): ScanCache => {
  const byPath = new Map<string, Map<string, unknown>>();
  let changes = 0;
  return {
    version: () => changes,
    read: (path, aspect, read) =>
      Effect.suspend(() => {
        const aspects = byPath.get(path);
        if (aspects?.has(aspect) === true) return Effect.succeed(aspects.get(aspect) as never);
        const before = changes;
        return Effect.map(read, (value) => {
          if (changes !== before) return value;
          const kept = byPath.get(path);
          if (kept === undefined) byPath.set(path, new Map([[aspect, value]]));
          else kept.set(aspect, value);
          return value;
        });
      }),
    changed: (path) => {
      if (invisibleToScans(path)) return;
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

/** `fs`, with every call that changes a path telling `cache` once the call is over. */
export const reportingChanges = (
  fs: FileSystem.FileSystem,
  cache: ScanCache,
): FileSystem.FileSystem => {
  const changing =
    <Args extends ReadonlyArray<unknown>, A, E, R>(
      call: (...args: Args) => Effect.Effect<A, E, R>,
      changes: (...args: Args) => ReadonlyArray<string>,
    ) =>
    (...args: Args): Effect.Effect<A, E, R> =>
      Effect.ensuring(
        call(...args),
        Effect.sync(() => {
          for (const path of changes(...args)) cache.changed(path);
        }),
      );
  const one = (path: string) => [path];
  const both = (from: string, to: string) => [from, to];
  return {
    ...fs,
    chmod: changing(fs.chmod, one),
    chown: changing(fs.chown, one),
    copy: changing(fs.copy, both),
    copyFile: changing(fs.copyFile, both),
    link: changing(fs.link, both),
    makeDirectory: changing(fs.makeDirectory, one),
    remove: changing(fs.remove, one),
    rename: changing(fs.rename, both),
    symlink: changing(fs.symlink, both),
    truncate: changing(fs.truncate, one),
    utimes: changing(fs.utimes, one),
    writeFile: changing(fs.writeFile, one),
    writeFileString: changing(fs.writeFileString, one),
  };
};
