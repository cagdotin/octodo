/**
 * The on-disk grammar of a workspace. `.octodo/` holds config.json and a folder per section:
 * `tasks/`, the root list, and one per enabled plugin that adds a section (decision 0027). A
 * folder with `task.md` is a task, and the task folders inside it are its subtasks. A folder with
 * `list.md` is a list. Folder
 * names mean nothing to the scanner: a task folder is named `<id>-<slug>` and a list folder is its
 * slug for people reading the tree, and a list's id is its folder names joined by `/`. The one
 * exception: the id a task folder's name starts with raises the next new id when its `task.md` is
 * not read.
 */
import {
  LINK_KINDS,
  TASK_ID,
  WORKSPACE_KEY,
  slugify,
  type LinkField,
} from "@octodo/contract/rules";

export const OCTODO_DIR = ".octodo";
/** The built-in section's folder in `.octodo/`, which is the root list. */
export const TASKS_SECTION = "tasks";
export const CONFIG_FILE = "config.json";
export const TASK_FILE = "task.md";
export const LIST_FILE = "list.md";

export const isWorkspaceKey = (key: string): boolean => WORKSPACE_KEY.test(key);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Task ids with a usual key, or with workspace key `key` when it is not a usual one. */
const taskIdSource = (key?: string) =>
  key === undefined || isWorkspaceKey(key) ? TASK_ID : `(?:${escapeRegExp(key)}-\\d+|${TASK_ID})`;

/**
 * Whether `id` has the shape of a task id: a key, a dash and a number, as in `HM-42`. A workspace
 * whose `key` has another shape still accepts the ids made with it.
 */
export const isTaskId = (id: string, key?: string): boolean =>
  new RegExp(`^${taskIdSource(key)}$`).test(id);

/**
 * The task ids written in `text`, and whether they are all it says: `HM-2, HM-3` is two ids,
 * `HM-2 after lunch` one id and some words.
 */
export const taskIdsIn = (
  text: string,
  key?: string,
): { readonly ids: Array<string>; readonly only: boolean } => {
  const pattern = new RegExp(taskIdSource(key), "g");
  return {
    ids: text.match(pattern) ?? [],
    only: text.replace(pattern, "").replace(/[\s,;]+/g, "") === "",
  };
};

/** The number in a task id such as `HM-42`, or null when the id is not in the workspace's format. */
export const idNumber = (id: string, key: string): number | null => {
  const match = new RegExp(`^${escapeRegExp(key)}-(\\d+)$`).exec(id);
  return match === null ? null : Number(match[1]);
};

/** `text` with each id that has key `from` given key `to` instead: `HM-3` becomes `OCT-3`. */
export const rekeyIds = (text: string, from: string, to: string): string =>
  text.replace(
    new RegExp(`(?<![A-Za-z0-9-])${escapeRegExp(from)}-(?=\\d+(?![A-Za-z0-9]))`, "g"),
    `${to}-`,
  );

/** The number of the id a task folder's `<id>-<slug>` name starts with, when it has key `key`. */
export const folderIdNumber = (name: string, key: string): number | null => {
  const match = new RegExp(`^${escapeRegExp(key)}-(\\d+)(?:-|$)`).exec(name);
  return match === null ? null : Number(match[1]);
};

export const taskFolderName = (id: string, title: string): string => {
  const slug = slugify(title).slice(0, 60).replace(/-+$/, "");
  return slug.length > 0 ? `${id}-${slug}` : id;
};

export const isLinkField = (key: string): key is LinkField =>
  LINK_KINDS.some((kind) => kind.field === key);
