import type { List, WorkspaceSnapshot } from "@octodo/core";
import { useMemo, useState } from "react";
import { parseQuickAdd, type QuickAdd } from "@/lib/quick-add";
import { allTags, listLabel, PRIORITIES } from "@/lib/tasks";
import type { Suggestions } from "./editor";

/** A quick-add draft: the text, what it parses to, and the chips the user made plain again. */
export interface QuickAddDraft {
  text: string;
  parsed: QuickAdd;
  /** The moment relative dates count from: when the box opened. */
  now: Date;
  /** Replaces the text from outside the editor (a reset, a picker); bumps `revision`. */
  setText: (text: string) => void;
  /** Counts `setText` calls, so the editor copies only outside changes, never a stale echo. */
  revision: number;
  /** The editor reporting what the user typed. */
  edited: (text: string) => void;
  /** Turns a chip's text back into plain title text (Todoist's click on a highlight). */
  makePlain: (tokenText: string) => void;
}

export function useQuickAdd(lists: ReadonlyArray<List>, initial = ""): QuickAddDraft {
  const [{ text, revision }, setDraft] = useState({ text: initial, revision: 0 });
  const [plain, setPlain] = useState<ReadonlySet<string>>(() => new Set());
  const [now] = useState(() => new Date());
  const parsed = useMemo(
    () => parseQuickAdd(text, { lists, now, plain }),
    [text, lists, now, plain],
  );
  return {
    text,
    parsed,
    now,
    revision,
    edited: (next) => setDraft((draft) => ({ ...draft, text: next })),
    setText: (next) => {
      setDraft((draft) => ({ text: next, revision: draft.revision + 1 }));
      if (next.trim() === "") setPlain(new Set());
    },
    makePlain: (tokenText) => setPlain((current) => new Set(current).add(tokenText.toLowerCase())),
  };
}

export type QuickAddSuggestions = Pick<Suggestions, "lists" | "tags" | "priorities">;

/** What the pickers offer for a workspace: its lists by full label, known tags, priorities. */
export const suggestionsFor = (snapshot: WorkspaceSnapshot): QuickAddSuggestions => ({
  lists: snapshot.lists.map((list) => ({ id: list.id, label: listLabel(snapshot.lists, list.id) })),
  tags: allTags(snapshot.tasks),
  priorities: PRIORITIES.map(({ value, label }) => ({ word: value, label })),
});
