/**
 * Plain functions with no Effect code, so the browser can import this module on its own
 * (`@octodo/core/layout`) without pulling the runtime in.
 *
 * The on-disk conventions of a workspace. Everything the app knows about a task's place comes
 * from folder names under `.octodo/`: `s<NN>-<id>` folders are statuses and `l<NN>-<slug>` folders
 * are lists. The number only orders a folder among its siblings; it is not part of the id, so
 * reordering renames folders without changing what anything refers to. A status folder belongs to
 * the nearest list above it, or to no list when it sits directly in `.octodo/`.
 */
export const TASKS_DIR = ".octodo";
export const CONFIG_FILE = "config.json";
export const STATUS_PREFIX = "s";
export const LIST_PREFIX = "l";
/** How deep lists nest: a top-level list, its sublists and theirs. */
export const MAX_LIST_DEPTH = 3;

export type FolderKind =
  | {
      readonly type: "status" | "list";
      readonly slug: string;
      /** The number after the prefix, or null for a folder named by hand without one. */
      readonly position: number | null;
    }
  | { readonly type: "ignored" }
  | { readonly type: "unknown" };

const NUMBERED = /^([a-z])(\d*)-(.+)$/;

export const classifyFolder = (name: string): FolderKind => {
  if (name.startsWith(".")) return { type: "ignored" };
  const match = NUMBERED.exec(name);
  if (match === null) return { type: "unknown" };
  const [, prefix, digits, slug] = match;
  const position = digits === "" ? null : Number(digits);
  if (prefix === STATUS_PREFIX) return { type: "status", slug: slug!, position };
  if (prefix === LIST_PREFIX) return { type: "list", slug: slug!, position };
  return { type: "unknown" };
};

const numbered = (prefix: string, position: number, slug: string) =>
  `${prefix}${String(position).padStart(2, "0")}-${slug}`;

export const statusFolder = (position: number, id: string): string =>
  numbered(STATUS_PREFIX, position, id);

export const listFolder = (position: number, slug: string): string =>
  numbered(LIST_PREFIX, position, slug);

/** Sorts numbered folders by number, then the ones without a number, each by slug. */
export const compareFolders = (
  a: { readonly slug: string; readonly position: number | null },
  b: { readonly slug: string; readonly position: number | null },
): number => {
  if (a.position !== b.position) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  }
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
};

export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const humanize = (slug: string): string =>
  slug
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Derives a Linear-style key from a project name: the initials of a multi-word name
 * (`house-move` → `CT`), or the first three letters of a single word (`garden` → `GAR`).
 */
export const deriveKey = (name: string): string => {
  const words = slugify(name)
    .split("-")
    .filter((word) => /[a-z]/.test(word));
  if (words.length === 0) return "TASK";
  if (words.length === 1)
    return words[0]!
      .replace(/[^a-z]/g, "")
      .slice(0, 3)
      .toUpperCase();
  return words
    .map((word) => word.replace(/[^a-z]/g, "")[0] ?? "")
    .join("")
    .slice(0, 5)
    .toUpperCase();
};

/** The number in a task id such as `CT-42`, or null when the id is not in the workspace's format. */
export const idNumber = (id: string, key: string): number | null => {
  const match = new RegExp(`^${key}-(\\d+)$`).exec(id);
  return match === null ? null : Number(match[1]);
};

export const taskFileName = (id: string, title: string): string => {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "");
  return slug.length > 0 ? `${id}-${slug}.md` : `${id}.md`;
};
