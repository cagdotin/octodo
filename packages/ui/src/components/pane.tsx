import type { ComponentProps, ReactNode } from "react";
import { cn } from "@octodo/ui/lib/utils";

/**
 * The hairline parts every pane is built from, so the task list and the panel beside it line up:
 * a 44px header, a 36px footer, 36px section headings and rows, all on one gutter.
 */
export function PaneHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "@container flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function PaneFooter({ className, ...props }: ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "@container flex h-9 shrink-0 items-center gap-3 border-t px-4 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A section's heading: its icon, name and count, and an action at the end. */
export function PaneHeading({
  icon,
  label,
  count,
  action,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b bg-background ps-4 pe-2 [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
    >
      {icon}
      <span className="text-[13px] font-medium">{label}</span>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      )}
      {action && <span className="ms-auto flex items-center">{action}</span>}
    </div>
  );
}

/** A row in a pane's list: a task, a relation, a subtask, the composer. */
export const PANE_ROW =
  "group/row relative flex h-9 items-center gap-3 border-b px-4 text-[13px] transition-colors duration-150 hover:bg-accent/60";
