import type { CreateTaskInput, Entry, Task } from "@octodo/contract";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { countersWeb } from "./counters/web.ts";
import { recurringWeb } from "./recurring/web.ts";

/** A task of a plugin's kind, with `kind.fields` as the plugin's `fields` schema encodes them. */
export type TaskOf<Fields> = Task & {
  readonly kind: { readonly id: string; readonly fields: Fields };
};

export interface KindProps<Fields> {
  readonly workspace: string;
  readonly task: TaskOf<Fields>;
}

/** What the new-task dialog asks of every task, whatever its kind. A kind's date replaces `due`. */
export type NewTask = Omit<CreateTaskInput, "due">;

export interface CreateFieldsProps<Draft> {
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
  /** Hands focus back to the dialog's title, where Enter creates, when a picker closes. */
  readonly finalFocus: () => false;
}

/** How the new-task dialog creates a task of this kind (decision 0023). */
export interface KindCreate<Draft> {
  /** One task of the kind, as the dialog's kind picker names it. */
  readonly noun: string;
  readonly Icon: LucideIcon;
  /** The kind's own fields of a new task, before any is set. */
  readonly empty: Draft;
  /** Chips in the dialog's property row that set the draft; mounted when the kind is picked. */
  readonly Fields?: ComponentType<CreateFieldsProps<Draft>>;
  readonly ready: (draft: Draft) => boolean;
  /** Calls the plugin's own create operation. */
  readonly create: (workspace: string, task: NewTask, draft: Draft) => Promise<Task>;
}

/**
 * A plugin's `web` half: what the app shows for a task of its kind (decision 0016). It renders
 * with `@octodo/ui` and calls only its own plugin's operations, through a client typed from them
 * (decision 0017).
 */
export interface PluginWeb<Fields, Draft = unknown> {
  /** Shown in a task row's date slot, in place of the due or created date. */
  readonly Row: ComponentType<{
    readonly task: TaskOf<Fields>;
    readonly className?: string | undefined;
  }>;
  /** A section of the task panel. */
  readonly Panel: ComponentType<KindProps<Fields>>;
  /**
   * The day a task of the kind is due on, which Today and Next 7 days read in place of `due`; the
   * same function as its shared half's `day` (decision 0025). None for a kind without one.
   */
  readonly day?: (fields: Fields, today: string) => string | null;
  /**
   * Whether a move into a completed status leaves the task open in the first unstarted status,
   * as the engine's `complete` does for this kind, so the app's optimistic update agrees.
   */
  readonly completesInPlace: boolean;
  readonly create: KindCreate<Draft>;
}

type KindFields = Readonly<Record<string, unknown>>;

/** Every plugin's web half, by its id, as `task.kind.id` names it. */
export const webPlugins: Readonly<Record<string, PluginWeb<KindFields>>> = {
  recurring: recurringWeb as unknown as PluginWeb<KindFields>,
};

/** An entry of a section plugin, with `fields` as the plugin's `fields` schema encodes them. */
export type EntryOf<Fields> = Entry & { readonly fields: Fields };

export interface EntryProps<Fields> {
  readonly workspace: string;
  readonly entry: EntryOf<Fields>;
}

/** A slice of a section that its sidebar lists under "All", as Tasks lists Today and Ready. */
export interface SectionView<Fields> {
  /** Its `?show=` in the URL. */
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Whether an entry is in the view on `today`, `YYYY-MM-DD`. */
  readonly matches: (fields: Fields, today: string) => boolean;
}

/** What the app hands a section's view: the entries of the chosen view in order, and the open one. */
export interface SectionViewProps<Fields> {
  readonly workspace: string;
  readonly entries: ReadonlyArray<EntryOf<Fields>>;
  /** The view shown, one of the section's `views`; undefined for all its entries. */
  readonly view: SectionView<Fields> | undefined;
  /** The id of the entry the panel shows, if any. */
  readonly selected: string | undefined;
  readonly onOpen: (id: string) => void;
  /** Whether the new-entry form is open: N and the toolbar's new button open it. */
  readonly composing: boolean;
  readonly onCompose: (open: boolean) => void;
}

/** What every entry has that the app's entry panel edits. */
export interface EntryPatch {
  readonly title?: string;
  readonly body?: string;
}

/**
 * A section plugin's `web` half (decision 0027): its place in the rail, its view, and its part of
 * the entry panel, whose title, body and delete the app owns, as it owns them for a task.
 */
export interface SectionWeb<Fields> {
  /** The section's name in the rail and the toolbar: "Counters". */
  readonly label: string;
  /** One entry, lowercase, as "New counter" and "Delete counter" name it. */
  readonly noun: string;
  readonly Icon: LucideIcon;
  /** The icon of one entry, its kind's, wherever the app shows it: Today, the entry panel. */
  readonly EntryIcon: ComponentType<{ readonly fields: Fields; readonly className?: string }>;
  /** The slices the sidebar lists after "All", in this order. */
  readonly views: ReadonlyArray<SectionView<Fields>>;
  readonly View: ComponentType<SectionViewProps<Fields>>;
  /** The entry panel's section between the body and the footer. */
  readonly Panel: ComponentType<EntryProps<Fields>>;
  /** Calls the plugin's own update operation. */
  readonly edit: (workspace: string, id: string, patch: EntryPatch) => Promise<unknown>;
  /** Calls the plugin's own delete operation. */
  readonly remove: (workspace: string, id: string) => Promise<unknown>;
  /** The day an entry falls on, as its shared half's `day` gives it (decisions 0025, 0027). */
  readonly day?: (fields: Fields, today: string) => string | null;
}

/** Every section plugin's web half, by its id, as `entry.section` names it. */
export const webSections: Readonly<Record<string, SectionWeb<KindFields>>> = {
  counters: countersWeb as unknown as SectionWeb<KindFields>,
};
