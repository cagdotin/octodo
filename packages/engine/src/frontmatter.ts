import { Data, Effect, Predicate } from "effect";
import { generateKeyBetween } from "fractional-indexing";
import { isMap, parseDocument, type Document } from "yaml";
import { isLinkField } from "./layout.ts";
import type { Problem } from "@octodo/contract";
import type { AssignedId } from "./storage/storage.ts";

export type FrontmatterRead<A> =
  | { readonly _tag: "Read"; readonly value: A }
  | { readonly _tag: "Invalid"; readonly problem: Problem };

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export const absent = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

export const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** A fractional order key, or "" (unordered) for none or one written by hand that is not a key. */
export const readOrder = (value: unknown): string => {
  const key = stringOrNull(value);
  if (key === null) return "";
  try {
    generateKeyBetween(key, null);
    return key;
  } catch {
    return "";
  }
};

const splitFrontmatter = (
  text: string,
): { readonly yaml: string | null; readonly body: string } => {
  const match = FRONTMATTER.exec(text);
  if (match === null) return { yaml: null, body: text };
  return { yaml: match[1] ?? "", body: text.slice(match[0].length).replace(/^\r?\n/, "") };
};

/** Whether the file starts with a `---` frontmatter block. */
export const hasFrontmatter = (text: string): boolean => splitFrontmatter(text).yaml !== null;

/** The `id` in a file's frontmatter, found even when the rest of the frontmatter does not parse. */
export const frontmatterId = (text: string): string | null => {
  const { yaml } = splitFrontmatter(text);
  return yaml === null ? null : (/^id:[ \t]*["']?([^\s"'#]+)/m.exec(yaml)?.[1] ?? null);
};

/** A file whose frontmatter does not parse, so octodo leaves it as it is. */
export class InvalidFrontmatter extends Data.TaggedError("InvalidFrontmatter")<{
  readonly message: string;
}> {}

const parseYaml = (yaml: string | null): Document | InvalidFrontmatter => {
  const doc = parseDocument(yaml ?? "");
  if (doc.errors.length === 0) return doc;
  const first = doc.errors[0]?.message.split("\n")[0]?.replace(/:$/, "") ?? "unknown error";
  return new InvalidFrontmatter({ message: `Invalid frontmatter: ${first}` });
};

/** The frontmatter as plain data, or why it is not a set of keys. */
export const readFrontmatter = (
  text: string,
):
  | { readonly data: Readonly<Record<string, unknown>>; readonly body: string }
  | { readonly error: string } => {
  const parts = splitFrontmatter(text);
  const doc = parseYaml(parts.yaml);
  if (doc instanceof InvalidFrontmatter) return { error: doc.message };
  let value: unknown;
  try {
    value = doc.toJS();
  } catch (error) {
    return {
      error: `Invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (value !== null && !Predicate.isObject(value))
    return { error: "Invalid frontmatter: it must be a set of key: value pairs" };
  return { data: (value ?? {}) as Record<string, unknown>, body: parts.body };
};

export const invalidFrontmatter = (error: string) => ({
  _tag: "Invalid" as const,
  problem: { kind: "invalid-frontmatter" as const, field: null, detail: error },
});

type FrontmatterChanges = Readonly<Record<string, unknown>> & { readonly id?: AssignedId };

const withChanges = (doc: Document, changes: FrontmatterChanges, body: string): string => {
  if (!isMap(doc.contents)) doc.contents = doc.createNode({});
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) doc.delete(key);
    else doc.set(key, isLinkField(key) ? doc.createNode(value, { flow: true }) : value);
  }
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n${body.length > 0 ? `\n${body.replace(/\n*$/, "\n")}` : ""}`;
};

/** A new file with `changes` as its frontmatter. */
export const newFrontmatter = (changes: FrontmatterChanges, body = ""): string =>
  withChanges(parseDocument(""), changes, body);

/**
 * Edits the frontmatter through the YAML document rather than re-serialising plain data, so keys
 * the app does not know about, their order and their comments survive. `undefined` removes a key.
 */
export const patchFrontmatter = (
  existing: string,
  changes: FrontmatterChanges,
  body?: string,
): Effect.Effect<string, InvalidFrontmatter> => {
  const parts = splitFrontmatter(existing);
  const doc = parseYaml(parts.yaml);
  return doc instanceof InvalidFrontmatter
    ? Effect.fail(doc)
    : Effect.succeed(withChanges(doc, changes, body ?? parts.body));
};
