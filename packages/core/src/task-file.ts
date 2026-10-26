import { Option, Predicate, Schema } from "effect";
import { isMap, parseDocument, type Document } from "yaml";
import { Priority, type CreateTaskInput, type Task, type UpdateTaskInput } from "./domain.ts";
import { humanize } from "./layout.ts";

/** Where a task file sits, which the file itself does not say. `path` is relative to the root. */
export interface TaskPlace {
  readonly status: string;
  readonly list: string | null;
  readonly path: string;
}

export type TaskFileRead =
  | { readonly _tag: "Task"; readonly task: Task }
  | { readonly _tag: "MissingId" }
  | { readonly _tag: "Invalid"; readonly message: string };

type FrontmatterFields = Omit<Task, "id" | "status" | "list" | "body" | "path" | "extra">;

type EditableKey = Exclude<keyof UpdateTaskInput, "body">;

/** The fields create and update write from their input, in the order a new file lists them. */
const EDITABLE = { title: true, priority: true, tags: true, due: true } satisfies Record<
  EditableKey,
  true
>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

const decodePriority = Schema.decodeUnknownOption(Priority);

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const readTags = (value: unknown): Array<string> =>
  Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];

const fileTitle = (path: string) => humanize(path.split(/[\\/]/).at(-1)!.replace(/\.md$/, ""));

const readFields = (data: Readonly<Record<string, unknown>>, path: string): FrontmatterFields => ({
  title: stringOrNull(data["title"]) ?? fileTitle(path),
  priority: Option.getOrElse(decodePriority(data["priority"]), () => "none" as const),
  tags: readTags(data["tags"]),
  due: stringOrNull(data["due"]),
  created: stringOrNull(data["created"]),
  updated: stringOrNull(data["updated"]),
  order: stringOrNull(data["order"]) ?? "",
});

const splitFrontmatter = (
  text: string,
): { readonly yaml: string | null; readonly body: string } => {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { yaml: null, body: text };
  return { yaml: match[1] ?? "", body: text.slice(match[0].length).replace(/^\r?\n/, "") };
};

const parseYaml = (yaml: string | null): Document => {
  const doc = parseDocument(yaml ?? "");
  if (doc.errors.length > 0) {
    throw new Error(`Invalid frontmatter: ${doc.errors[0]?.message ?? "unknown error"}`);
  }
  return doc;
};

/**
 * Edits the frontmatter through the YAML document rather than re-serialising plain data, so keys
 * the app does not know about, their order and their comments survive. `undefined` removes a key.
 */
const writeFrontmatter = (
  existing: string | null,
  changes: Readonly<Record<string, unknown>>,
  body?: string,
): string => {
  const parts = existing === null ? { yaml: null, body: "" } : splitFrontmatter(existing);
  const doc = parseYaml(parts.yaml);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({});
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, value);
  }
  const nextBody = body ?? parts.body;
  return `---\n${doc.toString({ lineWidth: 0 })}---\n${nextBody.length > 0 ? `\n${nextBody.replace(/\n*$/, "\n")}` : ""}`;
};

/** `null` removes the key; `undefined` leaves it alone. */
const editChanges = (input: UpdateTaskInput): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(EDITABLE) as Array<EditableKey>) {
    if (input[key] !== undefined) changes[key] = input[key] ?? undefined;
  }
  return changes;
};

export const readTaskFile = (text: string, place: TaskPlace): TaskFileRead => {
  let data: Readonly<Record<string, unknown>>;
  let body: string;
  try {
    const parts = splitFrontmatter(text);
    const value: unknown = parseYaml(parts.yaml).toJS();
    data = Predicate.isObject(value) ? (value as Record<string, unknown>) : {};
    body = parts.body;
  } catch (error) {
    return { _tag: "Invalid", message: String(error) };
  }
  const id = stringOrNull(data["id"]);
  if (id === null) return { _tag: "MissingId" };
  const fields = readFields(data, place.path);
  const extra = Object.fromEntries(
    Object.entries(data).filter(([key]) => key !== "id" && !Object.hasOwn(fields, key)),
  );
  return { _tag: "Task", task: { id, ...place, ...fields, body, extra } };
};

export const newTaskFile = (
  input: CreateTaskInput,
  { id, order, now }: { readonly id: string; readonly order: string; readonly now: string },
): string =>
  writeFrontmatter(
    null,
    {
      id,
      ...editChanges({ priority: "none", tags: [], ...input }),
      created: now,
      updated: now,
      order,
    },
    input.body ?? "",
  );

export const editTaskFile = (text: string, input: UpdateTaskInput, now: string): string =>
  writeFrontmatter(text, { updated: now, ...editChanges(input) }, input.body);

/** Sets the fields the workspace manages itself, keeping everything else in the file. */
export const patchTaskFile = (
  text: string,
  changes: Partial<Pick<Task, "id" | "order" | "updated">>,
): string => writeFrontmatter(text, changes);
