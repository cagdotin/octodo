import type { Entry, Problem } from "@octodo/contract";
import { findMentions } from "@octodo/contract/rules";
import {
  folderTitle,
  invalidFrontmatter,
  newFrontmatter,
  readFrontmatter,
  readId,
  readOrder,
  stringOrNull,
} from "../frontmatter.ts";
import type { AssignedId } from "../storage/storage.ts";

/** An entry as its marker file has it, before its plugin computes its fields. */
export type EntryFile = Omit<Entry, "section" | "fields" | "mentionedIn">;

/** The keys every entry's marker file has; its plugin's keys and `extra` are the rest. */
export const ENTRY_KEYS: ReadonlyArray<string> = ["id", "title", "created", "order"];

/** What the folder tree says about an entry, which its marker file does not. */
export interface EntryPlace {
  /** Path of the marker file relative to the workspace root. */
  readonly path: string;
  /** The entry folder's name, which titles an entry without a `title`. */
  readonly folder: string;
  readonly updated: string | null;
  readonly key: string;
}

export type EntryFileRead =
  | {
      readonly _tag: "Read";
      readonly value: EntryFile;
      /** The whole frontmatter, where its plugin finds its own keys. */
      readonly frontmatter: Readonly<Record<string, unknown>>;
    }
  | { readonly _tag: "Invalid"; readonly problem: Problem }
  | { readonly _tag: "MissingId" };

/** An entry's marker file read strictly, like `task.md`: without a usable id it is not an entry. */
export const readEntryFile = (text: string, place: EntryPlace): EntryFileRead => {
  const read = readFrontmatter(text);
  if ("error" in read) return invalidFrontmatter(read.error);
  const { data, body } = read;
  const id = readId(data, place.key);
  if (typeof id !== "string") return id;
  return {
    _tag: "Read",
    frontmatter: data,
    value: {
      id,
      title: stringOrNull(data["title"]) ?? folderTitle(place.folder, id),
      created: stringOrNull(data["created"]),
      updated: place.updated,
      order: readOrder(data["order"]),
      body,
      path: place.path,
      extra: Object.fromEntries(Object.entries(data).filter(([key]) => !ENTRY_KEYS.includes(key))),
      mentions: [...new Set(findMentions(body).map((mention) => mention.id))],
    },
  };
};

export const newEntryFile = (
  input: { readonly title: string; readonly body?: string | undefined },
  {
    id,
    keys,
    order,
    now,
  }: {
    readonly id: AssignedId;
    /** Its plugin's keys. */
    readonly keys: Readonly<Record<string, unknown>>;
    readonly order: string;
    readonly now: string;
  },
): string =>
  newFrontmatter({ id, title: input.title, ...keys, created: now, order }, input.body ?? "");
