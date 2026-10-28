/**
 * The templates a new workspace starts from (decision 0008): plain data the browser imports too.
 * A preset is copied into config.json when a workspace is created, so changing one here never
 * changes a workspace that exists.
 */
import type { StatusDefinition } from "./domain.ts";

export interface Preset {
  readonly name: string;
  /** One or two sentences for the add-workspace dialog and the `preset` field's description. */
  readonly description: string;
  readonly statuses: ReadonlyArray<StatusDefinition>;
  /** The plugins it enables, by id. */
  readonly plugins: ReadonlyArray<string>;
}

const CHECKLIST_STATUSES: ReadonlyArray<StatusDefinition> = [
  { id: "todo", name: "Todo", category: "unstarted" },
  { id: "done", name: "Done", category: "completed" },
];

/** In the order the add-workspace dialog shows them. */
export const PRESETS = {
  checklist: {
    name: "Checklist",
    description: "Todo and done, nothing else. For groceries, packing lists and errands.",
    statuses: CHECKLIST_STATUSES,
    plugins: [],
  },
  project: {
    name: "Project",
    description:
      "Backlog, todo, in progress, done, canceled and archived. For work that moves through stages.",
    statuses: [
      { id: "backlog", name: "Backlog", category: "backlog" },
      { id: "todo", name: "Todo", category: "unstarted" },
      { id: "in-progress", name: "In Progress", category: "started" },
      { id: "done", name: "Done", category: "completed" },
      { id: "canceled", name: "Canceled", category: "canceled" },
      { id: "archived", name: "Archived", category: "archived" },
    ],
    plugins: [],
  },
  chores: {
    name: "Chores",
    description:
      "A checklist whose tasks can repeat, with counters: water the plants every 3 days, days since the last descaling, birthdays.",
    statuses: CHECKLIST_STATUSES,
    plugins: ["recurring", "counters"],
  },
} as const satisfies Record<string, Preset>;

export type PresetId = keyof typeof PRESETS;

export const PRESET_IDS = Object.keys(PRESETS) as ReadonlyArray<PresetId>;

/** What a workspace created without a preset starts from. */
export const DEFAULT_PRESET: PresetId = "project";
