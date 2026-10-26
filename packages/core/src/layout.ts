/**
 * The on-disk conventions of a workspace. Everything the app knows about a task's place comes
 * from folder names under `.tasks/`: `s-<id>` folders are statuses, and folders whose prefix is a
 * configured list kind (`c-`, `p-`, ...) are lists. A status folder belongs to the nearest list
 * above it, or to no list when it sits directly in `.tasks/`.
 */
export const TASKS_DIR = ".tasks";
export const CONFIG_FILE = "config.json";
export const STATUS_PREFIX = "s";

export type FolderKind =
  | { readonly type: "status"; readonly id: string }
  | { readonly type: "list"; readonly kind: string; readonly slug: string }
  | { readonly type: "ignored" }
  | { readonly type: "unknown" };

export const classifyFolder = (
  name: string,
  listKinds: Readonly<Record<string, string>>,
): FolderKind => {
  if (name.startsWith(".")) return { type: "ignored" };
  const dash = name.indexOf("-");
  if (dash <= 0 || dash === name.length - 1) return { type: "unknown" };
  const prefix = name.slice(0, dash);
  const rest = name.slice(dash + 1);
  if (prefix === STATUS_PREFIX) return { type: "status", id: rest };
  if (prefix in listKinds) return { type: "list", kind: prefix, slug: rest };
  return { type: "unknown" };
};

export const statusFolder = (id: string): string => `${STATUS_PREFIX}-${id}`;

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
