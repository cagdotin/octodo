import type { WorkspaceSnapshot } from "@octodo/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  CircleIcon,
  InboxIcon,
  KanbanIcon,
  ListIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { ListGlyph, StatusIcon } from "@/components/task-bits";
import { useTheme } from "@/components/theme-provider";
import { useState } from "react";
import { AddWorkspaceDialog } from "@/components/add-workspace-dialog";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { workspacesQuery } from "@/lib/api";
import { listLabel, SMART } from "@/lib/tasks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
  snapshot: WorkspaceSnapshot;
  view: "list" | "board";
  onToggleView: () => void;
  onNewTask: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  workspace,
  snapshot,
  view,
  onToggleView,
  onNewTask,
}: Props) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useQuery(workspacesQuery);
  const { resolvedTheme, setTheme } = useTheme();
  const [addOpen, setAddOpen] = useState(false);
  const categories = new Map(snapshot.statuses.map((status) => [status.id, status.category]));

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };
  const goList = (list: string | undefined) =>
    run(
      () =>
        void navigate({
          to: "/w/$workspace",
          params: { workspace },
          search: (prev) => ({ ...prev, list, task: undefined }),
        }),
    );

  return (
    <>
      <CommandDialog open={open} onOpenChange={onOpenChange}>
        <Command>
          <CommandInput placeholder="Type a command or search tasks…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={run(() => requestAnimationFrame(onNewTask))}>
                <PlusIcon />
                New task
                <CommandShortcut>N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(onToggleView)}>
                {view === "list" ? <KanbanIcon /> : <ListIcon />}
                {view === "list" ? "Switch to board" : "Switch to list"}
              </CommandItem>
              <CommandItem
                onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
              >
                <MoonIcon />
                Toggle dark mode
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Go to">
              <CommandItem onSelect={goList(SMART.all)}>
                <InboxIcon />
                All tasks
              </CommandItem>
              <CommandItem onSelect={goList(SMART.today)}>
                <CalendarDaysIcon />
                Today
              </CommandItem>
              <CommandItem onSelect={goList(SMART.upcoming)}>
                <CalendarRangeIcon />
                Next 7 days
              </CommandItem>
              <CommandItem
                onSelect={run(
                  () => void navigate({ to: "/w/$workspace/settings", params: { workspace } }),
                )}
              >
                <SettingsIcon />
                Workspace settings
              </CommandItem>
              {snapshot.lists.map((list) => {
                return (
                  <CommandItem
                    key={list.id}
                    value={`list ${listLabel(snapshot.lists, list.id)}`}
                    onSelect={goList(list.id)}
                  >
                    <ListGlyph />
                    {listLabel(snapshot.lists, list.id)}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Workspaces">
              {workspaces.map((ws) => (
                <CommandItem
                  key={ws.id}
                  value={`workspace ${ws.name} ${ws.key}`}
                  onSelect={run(
                    () =>
                      void navigate({
                        to: "/w/$workspace",
                        params: { workspace: ws.id },
                        search: {},
                      }),
                  )}
                >
                  <CircleIcon className={ws.id === workspace ? "fill-current" : ""} />
                  {ws.name}
                  <CommandShortcut>{ws.key}</CommandShortcut>
                </CommandItem>
              ))}
              <CommandItem onSelect={run(() => setAddOpen(true))}>
                <PlusIcon />
                Add workspace…
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Tasks">
              {snapshot.tasks.map((task) => (
                <CommandItem
                  key={task.id}
                  value={`task ${task.id} ${task.title}`}
                  onSelect={run(
                    () =>
                      void navigate({
                        to: "/w/$workspace",
                        params: { workspace },
                        search: (prev) => ({ ...prev, task: task.id }),
                      }),
                  )}
                >
                  <StatusIcon category={categories.get(task.status)} />
                  <span className="truncate">{task.title}</span>
                  <CommandShortcut className="font-mono">{task.id}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
      <AddWorkspaceDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
