import type { ReactNode } from "react";
import { SidebarFooter, SidebarHeader } from "@octodo/ui/components/sidebar";
import { cn } from "@octodo/ui/lib/utils";

/** The sidebar's header, the same 44px hairline as the page's, so the rule runs straight across. */
export function SidebarTop({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <SidebarHeader
      className={cn("h-11 shrink-0 flex-row items-center gap-1 border-b px-2 py-0", className)}
    >
      {children}
    </SidebarHeader>
  );
}

/** The sidebar's footer, the same 36px hairline as the page's. */
export function SidebarBottom({ children }: { children: ReactNode }) {
  return (
    <SidebarFooter className="h-9 shrink-0 flex-row items-center gap-0.5 border-t px-2 py-0">
      {children}
    </SidebarFooter>
  );
}
