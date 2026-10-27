import { Option, Predicate, Schema } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { isMap, parseDocument, type Document } from "yaml";
import {
  DueDate,
  Priority,
  Tags,
  type CreateTaskInput,
  type DiagnosticKind,
  type FixAction,
  type Task,
  type UpdateTaskInput,
} from "./domain.ts";
import {
  LINK_KINDS,
  findMentions,
  humanize,
  isLinkField,
  isTaskId,
  type LinkField,
} from "./layout.ts";

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

/** What is wrong with a file, before the scanner says where. */
export interface Problem {
  readonly kind: DiagnosticKind;
  readonly field: string | null;
  readonly detail: string;
  /** Null when the kind's fix does not apply to this case. */
  readonly fix?: FixAction | null;
}

export type FrontmatterRead<A> =
  | { readonly _tag: "Read"; readonly value: A }
  | { readonly _tag: "Invalid"; readonly problem: Problem };

/** A task as its own file has it, before a snapshot adds what other tasks say about it. */
export type TaskFile = Omit<Task, "blocks" | "blocked" | "mentionedIn">;

/**
 * A task file read strictly. A bad optional field is a problem and reads as its default; a file
 * without a usable id or with frontmatter that does not parse is not a task at all.
 */
export type TaskFileRead =
  | {
      readonly _tag: "Read";
      readonly value: TaskFile;
      readonly problems: ReadonlyArray<Problem>;
    }
  | { readonly _tag: "Invalid"; readonly problem: Problem }
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
const decodeDue = Schema.decodeUnknownOption(DueDate);
const decodeTags = Schema.decodeUnknownOption(Tags);

const absent = (value: unknown) => value === undefined || value === null || value === "";

/** A field's value decoded through its schema, or the default with a problem when it does not decode. */
const decodeField = <A>(
  value: unknown,
  decode: (value: unknown) => Option.Option<A>,
  fallback: A,
  problem: Omit<Problem, "detail"> & { readonly detail: (value: string) => string },
  problems: Array<Problem>,
): A => {
  if (absent(value)) return fallback;
  const decoded = decode(value);
  if (Option.isSome(decoded)) return decoded.value;
  problems.push({ ...problem, detail: problem.detail(JSON.stringify(value)) });
  return fallback;
};

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

/**
 * The task ids in a link field. Anything but a list of ids is malformed; the ids found in it
 * (a lone id, or ids in nested lists from `[[HM-3]]`) are still read. `lossless` says the ids are
 * all it holds, so writing them as a list keeps everything.
 */
const readLinkField = (value: unknown) => {
  if (value === undefined || value === null) return { ids: [], malformed: false, lossless: true };
  const isId = (id: unknown): id is string => typeof id === "string" && id.length > 0;
  const found = [value].flat(Infinity);
  return {
    ids: [...new Set(found.filter(isId))],
    malformed: !Array.isArray(value) || !value.every(isId),
    lossless: found.every(isId),
  };
};

/** The ids in link field `field` other than the task's own, with a problem for each way it is wrong. */
const readLinks = (
  data: Readonly<Record<string, unknown>>,
  field: LinkField,
  id: string,
  problems: Array<Problem>,
): Array<string> => {
  const value = data[field];
  const { ids, malformed, lossless } = readLinkField(value);
  if (malformed)
    problems.push({
      kind: "malformed-link",
      field,
      detail: `${field} is ${JSON.stringify(value)}, not a list of task ids such as [HM-3]`,
      ...(lossless ? {} : { fix: null }),
    });
  if (ids.includes(id))
    problems.push({ kind: "self-link", field, detail: `${field} lists the task itself` });
  return ids.filter((other) => other !== id);
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
    const first = doc.errors[0]?.message.split("\n")[0]?.replace(/:$/, "") ?? "unknown error";
    throw new Error(`Invalid frontmatter: ${first}`);
  }
  return doc;
};

/** The frontmatter as plain data, or why it is not a set of keys. */
export const readFrontmatter = (
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
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const invalidFrontmatter = (error: string) => ({
  _tag: "Invalid" as const,
  problem: { kind: "invalid-frontmatter" as const, field: null, detail: error },
});

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

/** Whether `readTaskFile` would read the file as a task missing its id: it parses, without one. */
export const needsId = (text: string): boolean => {
  const read = readFrontmatter(text);
  return !("error" in read) && absent(read.data["id"]);
};

export const readTaskFile = (text: string, place: TaskPlace): TaskFileRead => {
  const read = readFrontmatter(text);
  if ("error" in read) return invalidFrontmatter(read.error);
  const { data, body } = read;
  const rawId = data["id"];
  if (absent(rawId)) return { _tag: "MissingId" };
  if (typeof rawId !== "string" || !isTaskId(rawId))
    return {
      _tag: "Invalid",
      problem: {
        kind: "malformed-id",
        field: "id",
        detail: `The id ${JSON.stringify(rawId)} is not a task id such as HM-1`,
      },
    };
  const id = rawId;
  const problems: Array<Problem> = [];
  return {
    _tag: "Read",
    problems,
    value: {
      id,
      title: stringOrNull(data["title"]) ?? folderTitle(place.folder, id),
      status: stringOrNull(data["status"]) ?? place.defaultStatus,
      list: place.list,
      parent: place.parent,
      priority: decodeField(
        data["priority"],
        decodePriority,
        "none",
        {
          kind: "unknown-priority",
          field: "priority",
          detail: (value) => `The priority ${value} is not one of ${Priority.literals.join(", ")}`,
        },
        problems,
      ),
      tags: decodeField(
        typeof data["tags"] === "string" ? [data["tags"]] : data["tags"],
        decodeTags,
        [],
        {
          kind: "invalid-tags",
          field: "tags",
          detail: (value) => `The tags ${value} are not a list of words`,
        },
        problems,
      ),
      due: decodeField(
        data["due"],
        decodeDue,
        null,
        {
          kind: "invalid-due",
          field: "due",
          detail: (value) => `The due date ${value} is not a date such as 2026-11-01`,
        },
        problems,
      ),
      created: stringOrNull(data["created"]),
      updated: place.updated,
      order: readOrder(data["order"]),
      body,
      path: place.path,
      extra: Object.fromEntries(Object.entries(data).filter(([key]) => !MANAGED.has(key))),
      blockedBy: readLinks(data, "blocked_by", id, problems),
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
 * The file with link field `field` rewritten as the list of ids it holds that `keep` accepts, and
 * without the key once none is left. Null when that changes nothing (no id dropped and the field
 * already a list of ids) or the frontmatter does not parse, so a rerun after a partial cleanup
 * rewrites only the files still left.
 */
export const keepLinks = (
  text: string,
  field: LinkField,
  keep: (id: string) => boolean,
): string | null => {
  const read = readFrontmatter(text);
  if ("error" in read) return null;
  const { ids, malformed } = readLinkField(read.data[field]);
  const kept = ids.filter(keep);
  if (kept.length === ids.length && !malformed) return null;
  return patchFrontmatter(text, { [field]: kept.length > 0 ? kept : undefined });
};

export interface ListFile {
  readonly name: string | null;
  readonly order: string;
  readonly body: string;
}

export const readListFile = (text: string): FrontmatterRead<ListFile> => {
  const read = readFrontmatter(text);
  if ("error" in read) return invalidFrontmatter(read.error);
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
