import { Option, Predicate, Schema } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { isMap, parseDocument, type Document } from "yaml";
import { Priority, type CreateTaskInput, type Task, type UpdateTaskInput } from "./domain.ts";
import { LINK_KINDS, findMentions, humanize, isLinkField, type LinkField } from "./layout.ts";

/** What the folder tree says about a task, which `task.md` itself does not. */
export interface TaskPlace {
  readonly list: string | null;
  readonly parent: string | null;
  /** Path of `task.md` relative to the workspace root. */
  readonly path: string;
  /** The task folder's name, which titles a task without a `title`. */
  readonly folder: string;
  /** The status a task without a `status` key reads as. */
  readonly defaultStatus: string;
  /** The file's modification time. */
  readonly updated: string | null;
}

export type FrontmatterRead<A> =
  | { readonly _tag: "Read"; readonly value: A }
  | { readonly _tag: "Invalid"; readonly message: string };

/** A task as its own file has it, before a snapshot adds what other tasks say about it. */
export type TaskFile = Omit<Task, "blocks" | "blocked" | "mentionedIn">;

export type TaskFileRead =
  | {
      readonly _tag: "Read";
      readonly value: TaskFile;
      /** Link fields that are not a list of task ids; `value` holds the ids found in them. */
      readonly malformedLinks: ReadonlyArray<LinkField>;
    }
  | { readonly _tag: "Invalid"; readonly message: string }
  | { readonly _tag: "MissingId" };

/** Keys the app reads into a task's fields; `updated` is no longer written but older files have it. */
const MANAGED = new Set([
  "id",
  "title",
  "status",
  "priority",
  "tags",
  "due",
  "created",
  "order",
  "updated",
  ...LINK_KINDS.map((kind) => kind.field),
]);

type EditableKey = Exclude<keyof UpdateTaskInput, "body">;

/** The fields create and update write from their input, in the order a new file lists them. */
const EDITABLE = {
  title: true,
  priority: true,
  tags: true,
  due: true,
  blocked_by: true,
} satisfies Record<EditableKey, true>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

const decodePriority = Schema.decodeUnknownOption(Priority);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** A fractional order key, or "" (unordered) for none or one written by hand that is not a key. */
const readOrder = (value: unknown): string => {
  const key = stringOrNull(value);
  if (key === null) return "";
  try {
    generateKeyBetween(key, null);
    return key;
  } catch {
    return "";
  }
};

const readTags = (value: unknown): Array<string> =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];

/**
 * The task ids in a link field. Anything but a list of ids is malformed; the ids found in it
 * (a lone id, or ids in nested lists from `[[HM-3]]`) are still read.
 */
const readLinkField = (
  value: unknown,
): { readonly ids: ReadonlyArray<string>; readonly malformed: boolean } => {
  if (value === undefined || value === null) return { ids: [], malformed: false };
  const found = [value].flat(Infinity);
  const ids = found.filter((id): id is string => typeof id === "string" && id.length > 0);
  const malformed =
    !Array.isArray(value) || value.some((id) => typeof id !== "string" || id.length === 0);
  return { ids: [...new Set(ids)], malformed };
};

const splitFrontmatter = (
  text: string,
): { readonly yaml: string | null; readonly body: string } => {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { yaml: null, body: text };
  return { yaml: match[1] ?? "", body: text.slice(match[0].length).replace(/^\r?\n/, "") };
};

/** The `id` in a file's frontmatter, found even when the rest of the frontmatter does not parse. */
export const frontmatterId = (text: string): string | null => {
  const { yaml } = splitFrontmatter(text);
  return yaml === null ? null : (/^id:[ \t]*["']?([^\s"'#]+)/m.exec(yaml)?.[1] ?? null);
};

const parseYaml = (yaml: string | null): Document => {
  const doc = parseDocument(yaml ?? "");
  if (doc.errors.length > 0) {
    throw new Error(`Invalid frontmatter: ${doc.errors[0]?.message ?? "unknown error"}`);
  }
  return doc;
};

const readFrontmatter = (
  text: string,
):
  | { readonly data: Readonly<Record<string, unknown>>; readonly body: string }
  | { readonly error: string } => {
  try {
    const parts = splitFrontmatter(text);
    const value: unknown = parseYaml(parts.yaml).toJS();
    if (value !== null && !Predicate.isObject(value))
      return { error: "Invalid frontmatter: it must be a set of key: value pairs" };
    return { data: (value ?? {}) as Record<string, unknown>, body: parts.body };
  } catch (error) {
    return { error: String(error) };
  }
};

/**
 * Edits the frontmatter through the YAML document rather than re-serialising plain data, so keys
 * the app does not know about, their order and their comments survive. `undefined` removes a key.
 */
export const patchFrontmatter = (
  existing: string | null,
  changes: Readonly<Record<string, unknown>>,
  body?: string,
): string => {
  const parts = existing === null ? { yaml: null, body: "" } : splitFrontmatter(existing);
  const doc = parseYaml(parts.yaml);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({});
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, isLinkField(key) ? doc.createNode(value, { flow: true }) : value);
  }
  const nextBody = body ?? parts.body;
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${nextBody.length > 0 ? `\n${nextBody.replace(/\n*$/, "\n")}` : ""}`;
};

/** Values the file leaves out rather than writes: no priority, no tags, no due date. */
const isDefault = (value: unknown) =>
  value === null || value === "none" || (Array.isArray(value) && value.length === 0);

/** The frontmatter changes for an edit: a default value removes its key, a missing one is untouched. */
const editChanges = (input: UpdateTaskInput): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(EDITABLE) as Array<EditableKey>) {
    if (input[key] !== undefined)
      changes[key] = key !== "title" && isDefault(input[key]) ? undefined : input[key];
  }
  return changes;
};

const folderTitle = (folder: string, id: string) =>
  humanize(folder.startsWith(id) ? folder.slice(id.length) : folder) || id;

export const readTaskFile = (text: string, place: TaskPlace): TaskFileRead => {
  const read = readFrontmatter(text);
  if ("error" in read) return { _tag: "Invalid", message: read.error };
  const { data, body } = read;
  const rawId = data["id"] ?? null;
  if (rawId !== null && typeof rawId !== "string")
    return { _tag: "Invalid", message: "Invalid frontmatter: id must be text, such as HM-1" };
  const id = stringOrNull(rawId);
  if (id === null) return { _tag: "MissingId" };
  const link = (field: LinkField) => readLinkField(data[field]);
  return {
    _tag: "Read",
    malformedLinks: LINK_KINDS.map((kind) => kind.field).filter((field) => link(field).malformed),
    value: {
      id,
      title: stringOrNull(data["title"]) ?? folderTitle(place.folder, id),
      status: stringOrNull(data["status"]) ?? place.defaultStatus,
      list: place.list,
      parent: place.parent,
      priority: Option.getOrElse(decodePriority(data["priority"]), () => "none" as const),
      tags: readTags(data["tags"]),
      due: stringOrNull(data["due"]),
      created: stringOrNull(data["created"]),
      updated: place.updated,
      order: readOrder(data["order"]),
      body,
      path: place.path,
      extra: Object.fromEntries(Object.entries(data).filter(([key]) => !MANAGED.has(key))),
      blockedBy: link("blocked_by").ids,
      mentions: [...new Set(findMentions(body).map((mention) => mention.id))],
    },
  };
};

export const newTaskFile = (
  input: CreateTaskInput,
  {
    id,
    status,
    order,
    now,
  }: { readonly id: string; readonly status: string; readonly order: string; readonly now: string },
): string =>
  patchFrontmatter(
    null,
    { id, title: input.title, status, ...editChanges(input), created: now, order },
    input.body ?? "",
  );

export const editTaskFile = (text: string, input: UpdateTaskInput): string =>
  patchFrontmatter(text, editChanges(input), input.body);

/**
 * The file without `ids` in any link field, or null when no link field lists one, so a rerun
 * after a partial cleanup rewrites only the files still left. Throws on invalid frontmatter.
 */
export const removeLinks = (text: string, ids: ReadonlySet<string>): string | null => {
  const read = readFrontmatter(text);
  if ("error" in read) throw new Error(read.error);
  const changes: Record<string, unknown> = {};
  for (const kind of LINK_KINDS) {
    const { ids: linked } = readLinkField(read.data[kind.field]);
    if (!linked.some((id) => ids.has(id))) continue;
    const kept = linked.filter((id) => !ids.has(id));
    changes[kind.field] = kept.length > 0 ? kept : undefined;
  }
  return Object.keys(changes).length > 0 ? patchFrontmatter(text, changes) : null;
};

export interface ListFile {
  readonly name: string | null;
  readonly order: string;
  readonly body: string;
}

export const readListFile = (text: string): FrontmatterRead<ListFile> => {
  const read = readFrontmatter(text);
  if ("error" in read) return { _tag: "Invalid", message: read.error };
  return {
    _tag: "Read",
    value: {
      name: stringOrNull(read.data["name"]),
      order: readOrder(read.data["order"]),
      body: read.body,
    },
  };
};

export const newListFile = (list: { readonly name: string; readonly order: string }): string =>
  patchFrontmatter(null, { name: list.name, order: list.order });

/**
 * A task file of the old layout as `task.md`: the status its folder gave it, no `updated`, and no
 * keys left at their default. Throws on invalid frontmatter.
 */
export const migratedTaskFile = (text: string, status: string): string => {
  const read = readFrontmatter(text);
  if ("error" in read) throw new Error(read.error);
  const defaults = Object.keys(EDITABLE).filter(
    (key) => key !== "title" && Object.hasOwn(read.data, key) && isDefault(read.data[key]),
  );
  return patchFrontmatter(text, {
    status,
    updated: undefined,
    ...Object.fromEntries(defaults.map((key) => [key, undefined])),
  });
};
