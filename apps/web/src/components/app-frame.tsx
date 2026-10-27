import { createContext, type CSSProperties, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { AppRail } from "@/components/app-rail";
import { Separator } from "@/components/ui/separator";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const FRAME = { "--rail-width": "3rem" } as CSSProperties;

const ToolbarSlot = createContext<HTMLElement | null>(null);

/**
 * The app window, laid out like Codex's: a toolbar across the top and the rail down the left share
 * the chrome tone, and the sidebar and the page sit inset below them as one card. Pages fill the
 * toolbar's title and actions through `PageToolbar`.
 */
export function AppFrame({ workspace, children }: { workspace: string; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SidebarProvider className="h-svh flex-col overflow-hidden bg-chrome" style={FRAME}>
      <Toolbar slotRef={setSlot} />
      <div className="flex min-h-0 flex-1">
        <AppRail workspace={workspace} />
        <div
          data-slot="app-card"
          className="flex min-w-0 flex-1 overflow-hidden border-t bg-background md:mr-1.5 md:mb-1.5 md:rounded-xl md:border md:shadow-card"
        >
          <ToolbarSlot.Provider value={slot}>{children}</ToolbarSlot.Provider>
        </div>
      </div>
    </SidebarProvider>
  );
}

/**
 * The toggle keeps its place whether the sidebar is open or not; the divider after it lines up with
 * the sidebar's edge while open. In the macOS app the lead leaves room for the traffic lights, which
 * Electron centres in this 52px strip.
 */
function Toolbar({ slotRef }: { slotRef: (element: HTMLElement | null) => void }) {
  const { state, isMobile } = useSidebar();
  const open = state === "expanded" && !isMobile;
  return (
    <header
      data-slot="toolbar"
      className="flex h-13 shrink-0 items-center select-none app-drag [--toolbar-lead:0.625rem] windowed-mac:[--toolbar-lead:4.75rem]"
    >
      <div
        className={cn(
          "flex h-full shrink-0 items-center justify-between pl-(--toolbar-lead) transition-[width] duration-200 ease-linear",
          open
            ? "w-[calc(var(--rail-width)+var(--sidebar-width)+1px)]"
            : "w-[calc(var(--toolbar-lead)+2.75rem)]",
        )}
      >
        <SidebarTrigger className="text-muted-foreground" />
        <Separator orientation="vertical" className="data-vertical:h-5 data-vertical:self-center" />
      </div>
      <div ref={slotRef} className="flex h-full min-w-0 flex-1 items-center gap-1 pr-2.5 pl-4" />
    </header>
  );
}

/** Puts the current page's title (with its icon) and its actions into the window's toolbar. */
export function PageToolbar({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  const slot = useContext(ToolbarSlot);
  if (!slot) return null;
  return createPortal(
    <>
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
        {icon}
        {title}
      </div>
      {children && <div className="ml-auto flex items-center gap-0.5">{children}</div>}
    </>,
    slot,
  );
}
