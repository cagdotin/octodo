import type { WorkspaceSnapshot } from "@octodo/contract";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CalendarRangeIcon,
  CircleIcon,
  InboxIcon,
  KanbanIcon,
  ListIcon,
  LockOpenIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { ListGlyph, StatusIcon } from "@/components/task-bits";
import { useTheme } from "@/components/theme-provider";
import { Fragment, useState, type ReactNode } from "react";
import { AddWorkspaceDialog } from "@/components/add-workspace-dialog";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from "@octodo/ui/components/command";
import { workspacesQuery } from "@/lib/api";
import { listLabel, SMART } from "@/lib/tasks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: string;
  snapshot: WorkspaceSnapshot;
  view: "list" | "board";
  onToggleView: () => void;
  /** Opens the new-task dialog, prefilled with `title` when given. */
  onNewTask: (title?: string) => void;
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
  const [query, setQuery] = useState("");
  const categories = new Map(snapshot.statuses.map((status) => [status.id, status.category]));

  const close = (action: () => void) => {
    onOpenChange(false);
    setQuery("");
    action();
  };
  const goList = (list: string | undefined) => () =>
    void navigate({
      to: "/w/$workspace",
      params: { workspace },
      search: (prev) => ({ ...prev, list, task: undefined }),
    });

  const groups: PaletteGroup[] = [
    {
      label: "Actions",
      items: [
        {
          text: "new task",
          label: "New task",
          icon: <PlusIcon />,
          shortcut: "⌘N",
          run: () => requestAnimationFrame(() => onNewTask()),
        },
        {
          text: "switch view board list",
          label: view === "list" ? "Switch to board" : "Switch to list",
          icon: view === "list" ? <KanbanIcon /> : <ListIcon />,
          run: onToggleView,
        },
        {
          text: "toggle dark mode",
          label: "Toggle dark mode",
          icon: <MoonIcon />,
          run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
        },
      ],
    },
    {
      label: "Go to",
      items: [
        { text: "all tasks", label: "All tasks", icon: <InboxIcon />, run: goList(SMART.all) },
        { text: "today", label: "Today", icon: <CalendarDaysIcon />, run: goList(SMART.today) },
        {
          text: "next 7 days",
          label: "Next 7 days",
          icon: <CalendarRangeIcon />,
          run: goList(SMART.upcoming),
        },
        { text: "ready", label: "Ready", icon: <LockOpenIcon />, run: goList(SMART.ready) },
        {
          text: "workspace settings",
          label: "Workspace settings",
          icon: <SettingsIcon />,
          run: () => void navigate({ to: "/w/$workspace/settings", params: { workspace } }),
        },
        ...snapshot.lists.map((list) => ({
          text: `list ${listLabel(snapshot.lists, list.id)}`,
          label: listLabel(snapshot.lists, list.id),
          icon: <ListGlyph />,
          run: goList(list.id),
        })),
      ],
    },
    {
      label: "Workspaces",
      items: [
        ...workspaces.map((ws) => ({
          text: `workspace ${ws.name} ${ws.key}`,
          label: ws.name,
          icon: <CircleIcon className={ws.id === workspace ? "fill-current" : ""} />,
          shortcut: ws.key,
          run: () =>
            void navigate({ to: "/w/$workspace", params: { workspace: ws.id }, search: {} }),
        })),
        {
          text: "add workspace",
          label: "Add workspace…",
          icon: <PlusIcon />,
          run: () => setAddOpen(true),
        },
      ],
    },
    {
      label: "Tasks",
      items: snapshot.tasks.map((task) => ({
        text: `task ${task.id} ${task.title}`,
        label: task.title,
        icon: <StatusIcon category={categories.get(task.status)} />,
        shortcut: task.id,
        run: () =>
          void navigate({
            to: "/w/$workspace",
            params: { workspace },
            search: (prev) => ({ ...prev, task: task.id }),
          }),
      })),
    },
    ...(query.trim() === ""
      ? []
      : [
          {
            label: "New task",
            items: [
              {
                text: "",
                always: true,
                label: `Create task "${query.trim()}"`,
                icon: <PlusIcon />,
                run: () => {
                  const title = query.trim();
                  requestAnimationFrame(() => onNewTask(title));
                },
              },
            ],
          },
        ]),
  ];

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setQuery("");
          onOpenChange(next);
        }}
      >
        <CommandDialogPopup
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
              event.preventDefault();
              const title = query.trim();
              close(() => requestAnimationFrame(() => onNewTask(title)));
            }
          }}
        >
          <Command
            items={groups}
            value={query}
            onValueChange={setQuery}
            itemToStringValue={(item) => (item as PaletteItem).text}
            filter={(value, search) => {
              const item = value as PaletteItem;
              return item.always === true || item.text.toLowerCase().includes(search.toLowerCase());
            }}
          >
            <CommandInput placeholder="Type a command or search tasks…" />
            <CommandPanel>
              <CommandList>
                {(group: PaletteGroup) => (
                  <Fragment key={group.label}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.label}</CommandGroupLabel>
                      <CommandCollection>
                        {(item: PaletteItem) => (
                          <CommandItem
                            key={item.text + item.label}
                            value={item}
                            className="gap-2"
                            onClick={() => close(item.run)}
                          >
                            {item.icon}
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.shortcut !== undefined && (
                              <CommandShortcut className="font-mono">
                                {item.shortcut}
                              </CommandShortcut>
                            )}
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    <CommandSeparator />
                  </Fragment>
                )}
              </CommandList>
            </CommandPanel>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
      <AddWorkspaceDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

interface PaletteItem {
  text: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  always?: boolean;
  run: () => void;
}

interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}
