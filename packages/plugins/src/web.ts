import type { Task } from "@octodo/contract";
import type { ComponentType } from "react";
import { counterWeb } from "./counter/web.tsx";
import { anniversaryWeb } from "./anniversary/web.tsx";
import { recurringWeb } from "./recurring/web.tsx";

/** A task of a plugin's kind, with `kind.fields` as the plugin's `fields` schema encodes them. */
export type TaskOf<Fields> = Task & {
  readonly kind: { readonly id: string; readonly fields: Fields };
};

export interface KindProps<Fields> {
  readonly workspace: string;
  readonly task: TaskOf<Fields>;
}

/**
 * A plugin's `web` half: what the app shows for a task of its kind (decision 0016). It renders
 * with `@octodo/ui` and calls only its own plugin's operations, through a client typed from them
 * (decision 0017).
 */
export interface PluginWeb<Fields> {
  /** Shown in a task row's date slot, in place of the due or created date. */
  readonly Row: ComponentType<{
    readonly task: TaskOf<Fields>;
    readonly className?: string | undefined;
  }>;
  /** A section of the task panel. */
  readonly Panel: ComponentType<KindProps<Fields>>;
  /**
   * Whether a move into a completed status leaves the task open in the first unstarted status,
   * as the engine's `complete` does for this kind, so the app's optimistic update agrees.
   */
  readonly completesInPlace: boolean;
}

type KindFields = Readonly<Record<string, unknown>>;

/** Every plugin's web half, by its id, as `task.kind.id` names it. */
export const webPlugins: Readonly<Record<string, PluginWeb<KindFields>>> = {
  recurring: recurringWeb as unknown as PluginWeb<KindFields>,
  counter: counterWeb as unknown as PluginWeb<KindFields>,
  anniversary: anniversaryWeb as unknown as PluginWeb<KindFields>,
};
