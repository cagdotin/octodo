import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { BoardView } from "@/components/board-view";
import { CommandPalette } from "@/components/command-palette";
import { DragAndDrop } from "@/components/drag-and-drop";
import { ListView } from "@/components/list-view";
import { NewTaskDialog } from "@/components/new-task-dialog";
import { TaskDetail } from "@/components/task-detail";
import { ViewHeader } from "@/components/workspace-header";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { WindowDragArea } from "@/components/window-drag-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { snapshotQuery } from "@/lib/api";
import { useHotkeys } from "@/lib/hotkeys";
import {
  lastWorkspace,
  showArchived as showArchivedPref,
  showBacklog as showBacklogPref,
  showCompleted as showCompletedPref,
} from "@/lib/prefs";
import {
  EMPTY_FILTER,
  filterTasks,
  matchesFilter,
  type DisplayOptions,
  type TaskFilter,
  viewTitle,
  visibleCategory,
} from "@/lib/tasks";

export type View = "list" | "board";

// `undefined` is allowed so links can clear a param; the router drops it from the URL.
export interface WorkspaceSearch {
  list?: string | undefined;
  view?: View | undefined;
  task?: string | undefined;
}

const str = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

export const Route = createFileRoute("/w/$workspace")({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const list = str(search["list"]);
    const task = str(search["task"]);
    return {
      ...(list !== undefined ? { list } : {}),
      ...(search["view"] === "board" ? { view: "board" as const } : {}),
      ...(task !== undefined ? { task } : {}),
    };
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(snapshotQuery(params.workspace)),
  pendingComponent: PendingWorkspace,
  errorComponent: ({ error }) => (
    <Empty className="h-svh">
      <WindowDragArea />
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>Couldn't open this workspace</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : String(error)}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ),
  component: WorkspacePage,
});

function PendingWorkspace() {
  return (
    <div className="flex h-svh items-center justify-center">
      <WindowDragArea />
      <Spinner />
    </div>
  );
}

function WorkspacePage() {
  const { workspace } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const isMobile = useIsMobile();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composing, setComposing] = useState<string | null>(null);
  // The new-task dialog, with its prefilled title; null while closed.
  const [newTask, setNewTask] = useState<{ title: string } | null>(null);
  // A filter on lists or tags from another workspace means nothing here, so it is per workspace.
  const [filterState, setFilterState] = useState({ workspace, filter: EMPTY_FILTER });
  const filter = filterState.workspace === workspace ? filterState.filter : EMPTY_FILTER;
  const setFilter = (next: TaskFilter) => setFilterState({ workspace, filter: next });
  const [display, setDisplayState] = useState<DisplayOptions>(() => ({
    showBacklog: showBacklogPref.get() !== "false",
    showCompleted: showCompletedPref.get() !== "false",
    showArchived: showArchivedPref.get() === "true",
  }));
  const view: View = search.view ?? "list";

  useEffect(() => lastWorkspace.set(workspace), [workspace]);

  const closeTask = () => void navigate({ search: (prev) => ({ ...prev, task: undefined }) });
  const setView = (next: View) =>
    void navigate({
      search: (prev) => ({ ...prev, view: next === "board" ? "board" : undefined }),
    });
  const setDisplay = (next: DisplayOptions) => {
    setDisplayState(next);
    showBacklogPref.set(String(next.showBacklog));
    showCompletedPref.set(String(next.showCompleted));
    showArchivedPref.set(String(next.showArchived));
  };
  // New task (N, C, the sidebar button, the palette) opens the new-task dialog.
  const compose = (title = "") => {
    setComposing(null);
    setNewTask({ title });
  };

  useHotkeys({
    "mod+k": () => setPaletteOpen((open) => !open),
    "mod+,": () => void navigate({ to: "/w/$workspace/settings", params: { workspace } }),
    n: () => compose(),
    c: () => compose(),
    escape: () => {
      if (composing !== null) setComposing(null);
      else if (search.task !== undefined) closeTask();
    },
  });

  if (!snapshot) return <PendingWorkspace />;

  const statuses = snapshot.statuses.filter((status) => visibleCategory(status.category, display));
  const shown = new Set(statuses.map((status) => status.id));
  const inList = filterTasks(snapshot.tasks, search.list);
  const tasks = inList.filter((task) => shown.has(task.status) && matchesFilter(task, filter));
  const title = viewTitle(search.list, snapshot.lists);
  const selected =
    search.task === undefined ? undefined : snapshot.tasks.find((task) => task.id === search.task);
  const detail = selected ? (
    <TaskDetail
      key={selected.id}
      workspace={workspace}
      snapshot={snapshot}
      task={selected}
      onClose={closeTask}
    />
  ) : null;
  const viewProps = {
    workspace,
    snapshot,
    statuses,
    tasks,
    selected: search.task,
    list: search.list,
    composing,
    onCompose: setComposing,
  };

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <DragAndDrop>
        <AppSidebar
          snapshot={snapshot}
          activeList={search.list}
          onSearch={() => setPaletteOpen(true)}
          onNewTask={() => compose()}
        />
        <SidebarInset className="min-w-0 overflow-hidden">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              <ViewHeader
                title={title}
                snapshot={snapshot}
                tasks={inList}
                view={view}
                onViewChange={setView}
                filter={filter}
                onFilterChange={setFilter}
                display={display}
                onDisplayChange={setDisplay}
              />
              {view === "list" ? <ListView {...viewProps} /> : <BoardView {...viewProps} />}
            </div>
            {!isMobile && detail && (
              <aside className="flex w-[400px] shrink-0 flex-col border-l bg-background lg:w-[440px]">
                {detail}
              </aside>
            )}
          </div>
        </SidebarInset>
      </DragAndDrop>
      {isMobile && (
        <Sheet open={detail !== null} onOpenChange={(open) => !open && closeTask()}>
          <SheetContent
            side="right"
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-none [&>button]:hidden"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{selected?.title ?? "Task"}</SheetTitle>
              <SheetDescription>Task details</SheetDescription>
            </SheetHeader>
            {detail}
          </SheetContent>
        </Sheet>
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        workspace={workspace}
        snapshot={snapshot}
        view={view}
        onToggleView={() => setView(view === "list" ? "board" : "list")}
        onNewTask={compose}
      />
      <NewTaskDialog
        open={newTask !== null}
        onOpenChange={(open) => !open && setNewTask(null)}
        workspace={workspace}
        snapshot={snapshot}
        list={search.list}
        title={newTask?.title ?? ""}
        onOpenTask={(id) => void navigate({ search: (prev) => ({ ...prev, task: id }) })}
      />
    </SidebarProvider>
  );
}
