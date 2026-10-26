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
export const showCompleted = pref("octodo:show-completed");
export const showArchived = pref("octodo:show-archived");
