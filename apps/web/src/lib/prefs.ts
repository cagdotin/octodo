// Small per-browser preferences. Storage can throw (private mode, blocked site data), so every
// access is guarded and the app works without it.
const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore.
  }
};

const pref = (key: string) => ({ get: () => read(key), set: (value: string) => write(key, value) });

export const lastWorkspace = pref("octodo:last-workspace");
export const theme = pref("octodo:theme");
export const showBacklog = pref("octodo:show-backlog");
export const showCompleted = pref("octodo:show-completed");
export const showArchived = pref("octodo:show-archived");
export const detailWidth = pref("octodo:detail-width");
export const sidebarWidth = pref("octodo:sidebar-width");

/** What is folded in a workspace's sidebar: the Lists section, and lists by id. */
export interface FoldedLists {
  readonly section: boolean;
  readonly lists: ReadonlyArray<string>;
}

const NOTHING_FOLDED: FoldedLists = { section: false, lists: [] };

export const foldedLists = (workspace: string) => {
  const stored = pref(`octodo:folded-lists:${workspace}`);
  return {
    get: (): FoldedLists => {
      try {
        const value: unknown = JSON.parse(stored.get() ?? "null");
        if (typeof value !== "object" || value === null) return NOTHING_FOLDED;
        const { section, lists } = value as Partial<FoldedLists>;
        return {
          section: section === true,
          lists: Array.isArray(lists) ? lists.filter((id) => typeof id === "string") : [],
        };
      } catch {
        return NOTHING_FOLDED;
      }
    },
    set: (value: FoldedLists) => stored.set(JSON.stringify(value)),
  };
};
