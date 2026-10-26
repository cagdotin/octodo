import { Predicate } from "effect";
import { isMap, parseDocument, type Document } from "yaml";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export interface TaskFile {
  readonly data: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** Splits a markdown file into its YAML frontmatter text (if any) and the body after it. */
export const splitFrontmatter = (
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

export const parseTaskFile = (text: string): TaskFile => {
  const { yaml, body } = splitFrontmatter(text);
  const value: unknown = parseYaml(yaml).toJS();
  return { data: Predicate.isObject(value) ? (value as Record<string, unknown>) : {}, body };
};

/**
 * Rewrites a task file with the given frontmatter changes and body. Editing goes through the YAML
 * document rather than re-serialising plain data, so keys the app does not know about, their
 * order and their comments survive. A value of `undefined` removes the key.
 */
export const writeTaskFile = (
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
