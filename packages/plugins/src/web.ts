import type { CreateTaskInput, Task } from "@octodo/contract";
import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { countersWeb } from "./counters/web.ts";
import { recurringWeb } from "./recurring/web.tsx";

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
  readonly onCloseAutoFocus: (event: Event) => void;
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

/** A section plugin's `web` half. */
export interface SectionWeb<Fields> {
  /** The day an entry falls on, as its shared half's `day` gives it (decisions 0025, 0027). */
  readonly day?: (fields: Fields, today: string) => string | null;
}

/** Every section plugin's web half, by its id, as `entry.section` names it. */
export const webSections: Readonly<Record<string, SectionWeb<KindFields>>> = {
  counters: countersWeb as unknown as SectionWeb<KindFields>,
};
