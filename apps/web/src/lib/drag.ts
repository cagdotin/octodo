import type { List, Task } from "@octodo/contract";
import type { ReactNode } from "react";

export type DragKind = "task" | "list";

interface DragBase {
  readonly overlay: () => ReactNode;
  /**
   * Pin the overlay's top-left corner to the pointer, for small overlays dragged from wide rows.
   * Without it the overlay keeps the grab offset, which suits cards the size of their overlay.
   */
  readonly atPointer?: boolean;
}

export type DragData =
  | (DragBase & { readonly type: "task"; readonly task: Task })
  | (DragBase & { readonly type: "list"; readonly list: List });

export interface DropData {
  readonly accepts: ReadonlyArray<DragKind>;
  /** A status group or column, which loses to the task rows inside it. */
  readonly column?: string;
  /** A list in the sidebar (null for "No list"). */
  readonly list?: string | null;
  /** Kinds this only takes from right under the pointer, never as the nearest fallback. */
  readonly pointerOnly?: DragKind;
}

export const dragData = (entity: { data: { current?: unknown } } | null | undefined) =>
  entity?.data.current as DragData | undefined;

export const dropData = (entity: { data: { current?: unknown } } | null | undefined) =>
  entity?.data.current as DropData | undefined;
