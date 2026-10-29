import { AnimatePresence, m } from "motion/react";
import { SearchIcon } from "lucide-react";
import {
  createContext,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AppRail } from "@/components/app-rail";
import { Kbd } from "@octodo/ui/components/kbd";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@octodo/ui/components/sidebar";
import { cn } from "@octodo/ui/lib/utils";
import { detailWidth, sidebarWidth } from "@/lib/prefs";

/** The frame's fixed widths, in px: the rail, the gutter around the cards, the panel's handle. */
const RAIL = 48;
const GUTTER = 6;
const HANDLE = 8;
/** The page is never squeezed below this; a wider panel folds the sidebar away first. */
const MIN_PAGE = 440;

const SIDEBAR = { min: 200, max: 400, initial: 256 } as const;
const PANEL = { min: 320, max: 960, initial: 420 } as const;

const spring = { type: "spring", stiffness: 500, damping: 40 } as const;

const ToolbarSlot = createContext<HTMLElement | null>(null);

const saved = (pref: { get: () => string | null }, initial: number) => {
  const width = Number(pref.get());
  return Number.isFinite(width) && width > 0 ? width : initial;
};

const subscribeToResize = (onResize: () => void) => {
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
};

const useViewportWidth = () => useSyncExternalStore(subscribeToResize, () => window.innerWidth);

/**
 * The app window, laid out like Codex's: a toolbar across the top and the rail down the left share
 * the chrome tone, and the sidebar and the page sit inset below them as one card. A detail panel
 * sits beside that card as a card of its own. Pages fill the toolbar's title and actions through
 * `PageToolbar`.
 */
export function AppFrame({
  workspace,
  panel,
  onSearch,
  children,
}: {
  workspace: string;
  /** A detail panel, shown as its own card beside the page with a handle to resize it. */
  panel?: ReactNode;
  /** Opens search; the toolbar shows a search field when there is one. */
  onSearch?: () => void;
  children: ReactNode;
}) {
  const [sidebar, setSidebar] = useState(() => saved(sidebarWidth, SIDEBAR.initial));
  const [resizing, setResizing] = useState(false);
  return (
    <SidebarProvider
      className={cn(
        "h-svh flex-col overflow-hidden bg-chrome",
        resizing &&
          "cursor-col-resize select-none **:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none **:data-[slot=toolbar-lead]:transition-none",
      )}
      style={{ "--rail-width": `${RAIL}px`, "--sidebar-width": `${sidebar}px` } as CSSProperties}
    >
      <FrameBody
        workspace={workspace}
        panel={panel}
        onSearch={onSearch}
        sidebar={sidebar}
        onSidebarResize={(width) => {
          setSidebar(width);
          sidebarWidth.set(String(width));
        }}
        onResizing={setResizing}
      >
        {children}
      </FrameBody>
    </SidebarProvider>
  );
}

function FrameBody({
  workspace,
  panel,
  onSearch,
  sidebar,
  onSidebarResize,
  onResizing,
  children,
}: {
  workspace: string;
  panel: ReactNode;
  onSearch: (() => void) | undefined;
  sidebar: number;
  onSidebarResize: (width: number) => void;
  onResizing: (resizing: boolean) => void;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => saved(detailWidth, PANEL.initial));
  const viewport = useViewportWidth();
  const { open, setOpen, isMobile } = useSidebar();

  // What the page card and the panel share; the sidebar lives inside the page card.
  const room = viewport - RAIL - GUTTER - (panel ? HANDLE + GUTTER : 0);
  const panelMax = Math.max(PANEL.min, Math.min(PANEL.max, room - MIN_PAGE));
  const shownPanel = Math.round(Math.min(Math.max(panelWidth, PANEL.min), panelMax));
  const page = room - (panel ? shownPanel : 0) - sidebar;
  useAutoCollapse({ page, open, setOpen, disabled: isMobile });

  return (
    <>
      <Toolbar slotRef={setSlot} onSearch={onSearch} />
      <div className="flex min-h-0 flex-1">
        <AppRail workspace={workspace} />
        <div
          data-slot="app-card"
          className={cn(
            "relative flex min-w-0 flex-1 overflow-hidden border-t bg-background md:mb-1.5 md:rounded-xl md:border md:shadow-card",
            !panel && "md:mr-1.5",
          )}
        >
          <ToolbarSlot.Provider value={slot}>{children}</ToolbarSlot.Provider>
          {open && !isMobile && (
            <ResizeHandle
              label="Resize sidebar"
              value={sidebar}
              min={SIDEBAR.min}
              max={SIDEBAR.max}
              initial={SIDEBAR.initial}
              grows="right"
              onChange={onSidebarResize}
              onDragging={onResizing}
              className="absolute inset-y-0 left-[calc(var(--sidebar-width)-4px)] z-20 w-2"
              grip={false}
            />
          )}
        </div>
        <SplitPanel
          width={shownPanel}
          max={panelMax}
          onResize={(width) => {
            setPanelWidth(width);
            detailWidth.set(String(width));
          }}
        >
          {panel}
        </SplitPanel>
      </div>
    </>
  );
}

/**
 * Folds the sidebar away when the page gets narrower than `MIN_PAGE` (a wider panel, a smaller
 * window) and brings it back once there is room again. Only a fold it made itself is undone, so a
 * sidebar the person closed stays closed.
 */
function useAutoCollapse({
  page,
  open,
  setOpen,
  disabled,
}: {
  page: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
}) {
  const folded = useRef(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (disabled) return;
    // Only a page that just got narrower folds it, so opening it again by hand sticks.
    const narrowed = last.current === null || page < last.current;
    last.current = page;
    if (open) folded.current = false;
    if (open && page < MIN_PAGE && narrowed) {
      folded.current = true;
      setOpen(false);
    } else if (!open && folded.current && page >= MIN_PAGE) {
      folded.current = false;
      setOpen(true);
    }
  }, [page, open, setOpen, disabled]);
}

/**
 * A focusable splitter: drag it, or press the arrow keys (Shift for bigger steps); Home and End go
 * to the limits, and a double click or Enter goes back to the default.
 */
function ResizeHandle({
  label,
  value,
  min,
  max,
  initial,
  grows,
  onChange,
  onDragging,
  className,
  grip = true,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  initial: number;
  /** Which way a drag widens what this handle resizes. */
  grows: "left" | "right";
  onChange: (width: number) => void;
  onDragging: (dragging: boolean) => void;
  className?: string;
  grip?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sign = grows === "right" ? 1 : -1;
  const set = (width: number) => onChange(Math.round(Math.min(Math.max(width, min), max)));
  const dragTo = (next: boolean) => {
    setDragging(next);
    onDragging(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: value };
    dragTo(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) set(drag.current.width + sign * (event.clientX - drag.current.x));
  };
  const onPointerUp = () => {
    drag.current = null;
    dragTo(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === "ArrowRight") set(value + sign * step);
    else if (event.key === "ArrowLeft") set(value - sign * step);
    else if (event.key === "Home") set(max);
    else if (event.key === "End") set(min);
    else if (event.key === "Enter") set(initial);
    else return;
    event.preventDefault();
  };

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a splitter holds its grip, which an hr cannot.
      role="separator"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the ARIA splitter pattern is a focusable separator.
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      data-dragging={dragging || undefined}
      className={cn(
        "group/handle flex shrink-0 cursor-col-resize touch-none items-center justify-center outline-none",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => set(initial)}
      onKeyDown={onKeyDown}
    >
      {grip ? (
        <m.span
          animate={{ scaleY: dragging ? 56 / 32 : 1 }}
          transition={spring}
          className={cn(
            "h-8 w-1 rounded-full bg-muted-foreground/24 transition-colors group-hover/handle:bg-muted-foreground/48 group-focus-visible/handle:bg-ring",
            dragging && "bg-foreground/60!",
          )}
        />
      ) : (
        <span className="h-full w-0.5 transition-colors group-hover/handle:bg-ring/60 group-focus-visible/handle:bg-ring group-data-dragging/handle:bg-ring" />
      )}
    </div>
  );
}

/** The detail panel as a card of its own, after a handle that resizes it; the width is kept. */
function SplitPanel({
  width,
  max,
  onResize,
  children,
}: {
  width: number;
  max: number;
  onResize: (width: number) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <AnimatePresence initial={false}>
      {children && (
        // The main column reflows as the panel opens, which only a width animation does.
        // react-doctor-disable-next-line react-doctor/no-layout-property-animation
        <m.div
          key="panel"
          className={cn("hidden shrink-0 overflow-hidden md:flex", dragging && "select-none")}
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: width + HANDLE + GUTTER, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={dragging ? { duration: 0 } : spring}
        >
          <ResizeHandle
            label="Resize panel"
            value={width}
            min={PANEL.min}
            max={max}
            initial={PANEL.initial}
            grows="left"
            onChange={onResize}
            onDragging={setDragging}
            className="relative w-2 before:absolute before:inset-y-0 before:-inset-x-1"
          />
          <section
            aria-label="Details"
            style={{ width }}
            className="relative mr-1.5 mb-1.5 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-background shadow-card"
          >
            {children}
            <AnimatePresence>
              {dragging && (
                <m.span
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="pointer-events-none absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 font-mono text-[11px] text-background tabular-nums"
                >
                  {width}px
                </m.span>
              )}
            </AnimatePresence>
          </section>
        </m.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The toggle keeps its place whether the sidebar is open or not; the divider after it lines up with
 * the sidebar's edge while open. In the macOS app the lead leaves room for the traffic lights, which
 * Electron centres in this 40px strip. Search sits in the middle of the window.
 */
function Toolbar({
  slotRef,
  onSearch,
}: {
  slotRef: (element: HTMLElement | null) => void;
  onSearch: (() => void) | undefined;
}) {
  const { state, isMobile } = useSidebar();
  const open = state === "expanded" && !isMobile;
  return (
    <header
      data-slot="toolbar"
      className="relative flex h-10 shrink-0 items-center select-none app-drag [--toolbar-lead:0.625rem] windowed-mac:[--toolbar-lead:4.75rem]"
    >
      <div
        data-slot="toolbar-lead"
        className={cn(
          "flex h-full shrink-0 items-center justify-between pl-(--toolbar-lead) transition-[width] duration-200 ease-linear",
          open
            ? "w-[calc(var(--rail-width)+var(--sidebar-width)+1px)]"
            : "w-[calc(var(--toolbar-lead)+2.75rem)]",
        )}
      >
        <SidebarTrigger className="text-muted-foreground" />
        <span aria-hidden className="h-4 w-px bg-border" />
      </div>
      <div ref={slotRef} className="flex h-full min-w-0 flex-1 items-center gap-1 pr-2.5 pl-4" />
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className="absolute top-1/2 left-1/2 hidden h-7 w-[min(22rem,34vw)] -translate-1/2 cursor-pointer items-center gap-2 rounded-lg border bg-background/60 px-2.5 text-[13px] text-muted-foreground shadow-xs/5 outline-none app-no-drag hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex"
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="truncate">Search tasks and commands</span>
          <Kbd className="ms-auto h-4.5 min-w-4.5 text-[10px]">⌘K</Kbd>
        </button>
      )}
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
