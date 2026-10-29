import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@octodo/ui/components/collapsible";
import {
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
} from "@octodo/ui/components/sidebar";
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

/**
 * A titled group of sidebar rows that folds away when its title is clicked. `action` is a button at
 * the header's end; using it unfolds the group first.
 */
export function Section({
  label,
  open,
  onOpenChange,
  action,
  children,
}: {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action?: { readonly label: string; readonly icon: ReactNode; readonly onClick: () => void };
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <SidebarGroup className="relative py-1">
        <SidebarGroupLabel
          className="h-7 w-full cursor-pointer rounded-lg ps-2 pe-8 text-[13px] font-normal text-sidebar-foreground/60 outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          render={<CollapsibleTrigger>{label}</CollapsibleTrigger>}
        />
        {action && (
          <button
            type="button"
            aria-label={action.label}
            title={action.label}
            className="absolute top-2 right-3 flex size-5 items-center justify-center rounded-md text-sidebar-foreground/60 outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4"
            onClick={() => {
              onOpenChange(true);
              action.onClick();
            }}
          >
            {action.icon}
          </button>
        )}
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">{children}</SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
