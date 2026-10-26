import { cn } from "@/lib/utils";

/**
 * A strip across the top of the window that drags it (and zooms it on double-click) in the macOS
 * desktop app, for screens without a header of their own. Not rendered anywhere else.
 */
export function WindowDragArea({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("fixed inset-x-0 top-0 hidden h-13 app-drag desktop-mac:block", className)}
    />
  );
}
