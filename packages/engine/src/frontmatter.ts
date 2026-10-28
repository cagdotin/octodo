import { Predicate } from "effect";
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

export const invalidFrontmatter = (error: string) => ({
  _tag: "Invalid" as const,
  problem: { kind: "invalid-frontmatter" as const, field: null, detail: error },
});

type FrontmatterChanges = Readonly<Record<string, unknown>> & { readonly id?: AssignedId };

/**
 * Edits the frontmatter through the YAML document rather than re-serialising plain data, so keys
 * the app does not know about, their order and their comments survive. `undefined` removes a key.
 */
export const patchFrontmatter = (
  existing: string | null,
  changes: FrontmatterChanges,
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
