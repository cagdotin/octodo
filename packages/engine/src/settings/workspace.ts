import { Effect, Result } from "effect";
import type { UpdateWorkspaceInput } from "@octodo/contract";
import { relative } from "node:path";
import { findMentions, LINK_KINDS } from "@octodo/contract/rules";
import { patchFrontmatter, readFrontmatter } from "../frontmatter.ts";
import { folderIdNumber, idNumber, rekeyIds } from "../layout.ts";
import { invalid, storageError, type State } from "../state.ts";
import type { Scan } from "../scan.ts";
import type { ConfigChanges } from "../storage/config.ts";
import type { Ids } from "../storage/storage.ts";
import { markedFolders } from "../storage/tree.ts";

/** The files and folder names that move a workspace's ids from key `from` to key `to`. */
interface Rekeying {
  readonly files: ReadonlyArray<{ readonly file: string; readonly text: string }>;
  /** Children before their parents, so each path is still there when its turn comes. */
  readonly folders: ReadonlyArray<{ readonly dir: string; readonly name: string }>;
}

const rekeyValue = (value: unknown, from: string, to: string): unknown => {
  if (typeof value === "string") return rekeyIds(value, from, to);
  if (Array.isArray(value)) return value.map((item) => rekeyValue(item, from, to));
  return value;
};

const rekeyMentions = (body: string, from: string, to: string): string =>
  findMentions(body)
    .filter((mention) => idNumber(mention.id, from) !== null)
    .toReversed()
    .reduce(
      (text, { from: start, to: end }) =>
        text.slice(0, start) + rekeyIds(text.slice(start, end), from, to) + text.slice(end),
      body,
    );

/** Refuses when a marker does not read, or when both `HM-3` and its new `OCT-3` are on disk. */
const planRekeying = (scan: Scan, ids: Ids, from: string, to: string) =>
  Effect.gen(function* () {
    const root = scan.snapshot.workspace.root;
    const folders = markedFolders(scan.tree);
    const unreadable: Array<string> = [];
    const numbers = { from: new Set<number>(), to: new Set<number>() };
    const files: Array<Rekeying["files"][number]> = [];

    for (const folder of folders) {
      const text = Result.isSuccess(folder.text) ? folder.text.success : null;
      const read = text === null ? null : readFrontmatter(text);
      if (text === null || read === null || "error" in read) {
        unreadable.push(relative(root, folder.file));
        continue;
      }
      const id = typeof read.data["id"] === "string" ? read.data["id"] : null;
      const number = id === null ? null : idNumber(id, from);
      if (number !== null) numbers.from.add(number);
      const taken = id === null ? null : idNumber(id, to);
      if (taken !== null) numbers.to.add(taken);

      const changes: Record<string, unknown> = {};
      if (id !== null && number !== null) changes["id"] = ids.rekeyed(id, to);
      for (const { field } of LINK_KINDS) {
        const value = read.data[field];
        const rekeyed = rekeyValue(value, from, to);
        if (JSON.stringify(rekeyed) !== JSON.stringify(value)) changes[field] = rekeyed;
      }
      const body = rekeyMentions(read.body, from, to);
      if (Object.keys(changes).length === 0 && body === read.body) continue;
      files.push({
        file: folder.file,
        text:
          Object.keys(changes).length === 0
            ? text.slice(0, text.length - read.body.length) + body
            : yield* patchFrontmatter(text, changes, body),
      });
    }

    if (unreadable.length > 0)
      return yield* invalid(
        `Fix the frontmatter of ${unreadable.join(", ")} first: its ids could not be changed`,
      );
    const clashes = [...numbers.from].filter((number) => numbers.to.has(number));
    if (clashes.length > 0)
      return yield* invalid(
        `${clashes.map((number) => `${to}-${number}`).join(", ")} already ${clashes.length === 1 ? "exists" : "exist"} next to ${clashes.map((number) => `${from}-${number}`).join(", ")}; pick another key`,
      );

    return {
      files,
      folders: folders
        .filter((folder) => folder.type !== "list" && folderIdNumber(folder.name, from) !== null)
        .map((folder) => ({ dir: folder.path, name: `${to}${folder.name.slice(from.length)}` }))
        .toReversed(),
    } satisfies Rekeying;
  });

/**
 * Sets the name, description and key in config.json. A new key first moves every id that has the
 * old one, in ids, links, mentions and folder names, and config.json is written last: until then
 * new ids count from the old key's, so a run that stopped halfway is finished by running it again.
 */
export const updateWorkspace = (state: State, input: UpdateWorkspaceInput) =>
  state.write((files, ids) =>
    Effect.gen(function* () {
      const name = input.name?.trim();
      if (name === "") return yield* invalid("A workspace needs a name");
      const description =
        input.description === undefined ? undefined : input.description?.trim() || null;
      yield* files.editConfig(() => null).pipe(storageError("Could not read config.json"));
      const scan = yield* state.scan;
      const from = scan.snapshot.workspace.key;
      const to = input.key ?? from;
      const rekeying =
        to === from
          ? null
          : yield* planRekeying(scan, ids, from, to).pipe(
              Effect.catchTag("InvalidFrontmatter", (error) => invalid(error.message)),
            );
      yield* Effect.gen(function* () {
        for (const { file, text } of rekeying?.files ?? []) yield* files.writeFile(file, text);
        for (const { dir, name } of rekeying?.folders ?? []) yield* files.renameFolder(dir, name);
        yield* files.editConfig((config) => {
          const changes: ConfigChanges = {
            ...(name === undefined || name === config.name ? {} : { name }),
            ...(to === config.key ? {} : { key: to }),
            ...(description === undefined || (description ?? undefined) === config.description
              ? {}
              : { description: description ?? undefined }),
          };
          return Object.keys(changes).length === 0 ? null : changes;
        });
      }).pipe(storageError("Could not update the workspace"));
      return (yield* state.scan).snapshot.workspace;
    }),
  );
