import { Effect, Option, Schema } from "effect";
import { isTaskId, taskIdsIn } from "../layout.ts";
import {
  DueDate,
  Priority,
  Tags,
  type CreateTaskInput,
  type Problem,
  type Task,
  type UpdateTaskInput,
} from "@octodo/contract";
import { findMentions, humanize, type LinkField } from "@octodo/contract/rules";
import {
  absent,
  invalidFrontmatter,
  type InvalidFrontmatter,
  newFrontmatter,
  patchFrontmatter,
  readFrontmatter,
  readOrder,
  stringOrNull,
} from "../frontmatter.ts";
import { plainTask } from "../plugins/plugin.ts";
import type { AssignedId } from "../storage/storage.ts";

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
  /** The workspace key, whose ids are task ids even when it is not of the usual shape. */
  readonly key: string;
}

/** A task as its own file has it, before a snapshot adds what other tasks say about it. */
export type TaskFile = Omit<Task, "blocks" | "blocked" | "ready" | "mentionedIn">;

/**
 * A task file read strictly. A bad optional field is a problem and reads as its default; a file
 * without a usable id or with frontmatter that does not parse is not a task at all.
 */
export type TaskFileRead =
  | {
      readonly _tag: "Read";
      readonly value: TaskFile;
      readonly problems: ReadonlyArray<Problem>;
      /** The whole frontmatter, where a kind finds its own keys. */
      readonly frontmatter: Readonly<Record<string, unknown>>;
    }
  | { readonly _tag: "Invalid"; readonly problem: Problem }
  | { readonly _tag: "MissingId" };

/** Keys the plain task reads into a task's fields; the rest are `extra` until a kind claims them. */
const MANAGED: ReadonlySet<string> = new Set(Object.keys(plainTask.keys.fields));

type EditableKey = Exclude<keyof UpdateTaskInput, "body">;

/** The fields create and update write from their input, in the order a new file lists them. */
const EDITABLE = {
  title: true,
  priority: true,
  tags: true,
  due: true,
  blocked_by: true,
} satisfies Record<EditableKey, true>;

const decodePriority = Schema.decodeUnknownOption(Priority);
const decodeDue = Schema.decodeUnknownOption(DueDate);
const decodeTags = Schema.decodeUnknownOption(Tags);

const scalarTag = (tag: unknown): unknown =>
  typeof tag === "number" || typeof tag === "boolean" ? String(tag) : tag;

/** Tags as words: a lone tag as a list of one, and numbers and booleans as they are written. */
const tagsAsWritten = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(scalarTag)
    : value === undefined || value === null || typeof value === "object"
      ? value
      : [scalarTag(value)];

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

/**
 * The task ids in a link field. Anything but a list of ids is malformed; the ids found in it
 * (a lone id, ids in a string such as `HM-2, HM-3`, or ids in nested lists from `[[HM-3]]`) are
 * still read. `lossless` says the ids are all it holds, so writing them as a list keeps everything.
 */
const readLinkField = (value: unknown, key: string) => {
  if (value === undefined || value === null) return { ids: [], malformed: false, lossless: true };
  const isId = (item: unknown): item is string => typeof item === "string" && isTaskId(item, key);
  const found = [value]
    .flat(Infinity)
    .map((item) => (typeof item === "string" ? taskIdsIn(item, key) : { ids: [], only: false }));
  return {
    ids: [...new Set(found.flatMap((item) => item.ids))],
    malformed: !Array.isArray(value) || !value.every(isId),
    lossless: found.every((item) => item.only),
  };
};

/** The ids in link field `field` other than the task's own, with a problem for each way it is wrong. */
const readLinks = (
  data: Readonly<Record<string, unknown>>,
  field: LinkField,
  id: string,
  key: string,
  problems: Array<Problem>,
): Array<string> => {
  const value = data[field];
  const { ids, malformed, lossless } = readLinkField(value, key);
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
  if (typeof rawId !== "string" || !isTaskId(rawId, place.key))
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
    frontmatter: data,
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
        tagsAsWritten(data["tags"]),
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
      blockedBy: readLinks(data, "blocked_by", id, place.key, problems),
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
    kind,
  }: {
    readonly id: AssignedId;
    readonly status: string;
    readonly order: string;
    readonly now: string;
    /** A plugin's kind, written as `type` and that plugin's keys. */
    readonly kind?: NewKind | undefined;
  },
): string =>
  newFrontmatter(
    {
      id,
      title: input.title,
      ...(kind === undefined ? {} : { type: kind.id, ...kind.keys }),
      status,
      ...editChanges(input),
      created: now,
      order,
    },
    input.body ?? "",
  );

/** The kind a new task is of, with its plugin's keys. */
export interface NewKind {
  readonly id: string;
  readonly keys: Readonly<Record<string, unknown>>;
}

export const editTaskFile = (text: string, input: UpdateTaskInput) =>
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
  key: string,
): Effect.Effect<string | null, InvalidFrontmatter> => {
  const read = readFrontmatter(text);
  if ("error" in read) return Effect.succeed(null);
  const { ids, malformed } = readLinkField(read.data[field], key);
  const kept = ids.filter(keep);
  if (kept.length === ids.length && !malformed) return Effect.succeed(null);
  return patchFrontmatter(text, { [field]: kept.length > 0 ? kept : undefined });
};
