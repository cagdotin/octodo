export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TASK_ITEM = /^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\](?:\s|$)/;

/** Counts GFM task-list items (`- [ ]`, `- [x]`) outside code fences; `null` when there are none. */
export const checklistProgress = (body: string): ChecklistProgress | null => {
  let done = 0;
  let total = 0;
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const opener = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (opener !== undefined && opener[0] === fence[0] && opener.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (opener !== undefined) {
      fence = opener;
      continue;
    }
    const mark = TASK_ITEM.exec(line)?.[1];
    if (mark === undefined) continue;
    total += 1;
    if (mark !== " ") done += 1;
  }
  return total === 0 ? null : { done, total };
};
