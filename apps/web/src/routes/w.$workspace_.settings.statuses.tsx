import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusCategory, StatusDefinition } from "@octodo/contract";
import { defaultStatus } from "@octodo/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GripVerticalIcon } from "lucide-react";
import { Rows, Section, SettingsPage } from "@/components/settings-page";
import { StatusIcon } from "@/components/task-bits";
import { Badge } from "@octodo/ui/components/badge";
import { snapshotQuery, useReorderStatuses } from "@/lib/api";
import { cn } from "@octodo/ui/lib/utils";

export const Route = createFileRoute("/w/$workspace_/settings/statuses")({
  component: StatusSettings,
});

/** Categories in workflow order, which is fixed; only the statuses inside one can be reordered. */
const CATEGORIES: ReadonlyArray<{ value: StatusCategory; label: string; help: string }> = [
  {
    value: "backlog",
    label: "Backlog",
    help: "Ideas and later. The list shows them when you ask.",
  },
  {
    value: "unstarted",
    label: "Unstarted",
    help: "Ready to pick up. New tasks start in the first one.",
  },
  { value: "started", label: "Started", help: "In progress." },
  { value: "completed", label: "Completed", help: "Done. A closed task no longer blocks another." },
  { value: "canceled", label: "Canceled", help: "Closed without being done." },
  { value: "archived", label: "Archived", help: "Put away. The list shows them when you ask." },
];

function StatusSettings() {
  const { workspace } = Route.useParams();
  const { data: snapshot } = useQuery(snapshotQuery(workspace));
  const reorder = useReorderStatuses(workspace);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!snapshot) return null;

  const statuses = snapshot.statuses;
  const fallback = defaultStatus(statuses)?.id;
  const counts = new Map<string, number>();
  for (const task of snapshot.tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = statuses.findIndex((status) => status.id === active.id);
    const to = statuses.findIndex((status) => status.id === over.id);
    if (from === -1 || to === -1 || statuses[from]!.category !== statuses[to]!.category) return;
    reorder.mutate(arrayMove([...statuses], from, to).map((status) => status.id));
  };

  return (
    <SettingsPage
      title="Statuses"
      description={
        <>
          The workflow tasks go through from start to completion. A task keeps its status id in the{" "}
          <Code>status</Code> field of its <Code>task.md</Code>, and this order lives in{" "}
          <Code>config.json</Code>.
        </>
      }
    >
      <Section
        title="Workflow"
        description="The category decides where a status shows and how it behaves. Drag to reorder statuses within one."
      >
        <Rows>
          {CATEGORIES.map((category) => {
            const items = statuses.filter((status) => status.category === category.value);
            return (
              <section key={category.value}>
                <h3 className="flex items-baseline gap-2 border-b bg-muted/30 px-4 py-2 text-xs">
                  <span className="font-medium">{category.label}</span>
                  <span className="truncate text-muted-foreground">{category.help}</span>
                </h3>
                {items.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground/70">No statuses</p>
                ) : (
                  // A drag context per category: a status cannot leave its category.
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                  >
                    <SortableContext
                      items={items.map((status) => status.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="divide-y">
                        {items.map((status) => (
                          <StatusRow
                            key={status.id}
                            status={status}
                            count={counts.get(status.id) ?? 0}
                            isDefault={status.id === fallback}
                            sortable={items.length > 1}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                )}
              </section>
            );
          })}
        </Rows>
      </Section>
    </SettingsPage>
  );
}

const Code = ({ children }: { children: string }) => (
  <code className="font-mono text-[11px]">{children}</code>
);

function StatusRow({
  status,
  count,
  isDefault,
  sortable,
}: {
  status: StatusDefinition;
  count: number;
  isDefault: boolean;
  sortable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
    disabled: !sortable,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/status relative flex items-center gap-3 bg-card px-4 py-2.5",
        sortable && "cursor-grab active:cursor-grabbing",
        isDragging && "z-10 rounded-lg shadow-md ring-1 ring-border",
      )}
      {...attributes}
      {...listeners}
    >
      <StatusIcon category={status.category} className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{status.name}</span>
        {isDefault && (
          <Badge size="sm" variant="outline">
            Default
          </Badge>
        )}
      </span>
      <span className="hidden font-mono text-xs text-muted-foreground sm:inline">{status.id}</span>
      <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
        {count === 1 ? "1 task" : `${count} tasks`}
      </span>
      <GripVerticalIcon
        className={cn(
          "size-4 shrink-0 text-muted-foreground/50 transition-opacity",
          sortable ? "opacity-0 group-hover/status:opacity-100" : "invisible",
        )}
      />
    </li>
  );
}
