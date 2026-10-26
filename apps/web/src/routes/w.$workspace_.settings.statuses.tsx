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
import type { StatusCategory, StatusDefinition } from "@octodo/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GripVerticalIcon } from "lucide-react";
import { SettingsPage } from "@/components/settings-page";
import { StatusIcon } from "@/components/task-bits";
import { Card } from "@/components/ui/card";
import { snapshotQuery, useReorderStatuses } from "@/lib/api";
import { cn } from "@/lib/utils";
import { defaultStatus } from "@/lib/tasks";

export const Route = createFileRoute("/w/$workspace_/settings/statuses")({
  component: StatusSettings,
});

/** Categories in workflow order, which is fixed; only the statuses inside one can be reordered. */
const CATEGORIES: ReadonlyArray<{ value: StatusCategory; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "unstarted", label: "Unstarted" },
  { value: "started", label: "Started" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
  { value: "archived", label: "Archived" },
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
          The workflow tasks go through from start to completion. The category decides where a
          status shows and how it behaves; drag to reorder statuses within one. Each status is a{" "}
          <code className="font-mono text-xs">s&lt;NN&gt;-&lt;id&gt;</code> folder, numbered in this
          order.
        </>
      }
    >
      <Card className="gap-1 p-2">
        {CATEGORIES.map((category) => {
          const items = statuses.filter((status) => status.category === category.value);
          return (
            <section key={category.value} className="flex flex-col gap-1">
              <h2 className="flex h-9 items-center rounded-md bg-muted px-3 text-sm text-muted-foreground">
                {category.label}
              </h2>
              {items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground/70">No statuses</p>
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
                    <ul className="flex flex-col">
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
      </Card>
    </SettingsPage>
  );
}

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
        "group/status relative flex items-center gap-3 rounded-md bg-card px-3 py-2.5",
        sortable && "cursor-grab active:cursor-grabbing",
        isDragging && "z-10 shadow-md ring-1 ring-border",
      )}
      {...attributes}
      {...listeners}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
        <StatusIcon category={status.category} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">
          {status.name}
          {isDefault && <span className="font-normal text-muted-foreground"> · Default</span>}
        </span>
        <span className="text-sm text-muted-foreground">
          {count === 1 ? "1 task" : `${count} tasks`}
          <span className="font-mono text-xs"> · {status.id}</span>
        </span>
      </span>
      {sortable && (
        <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/status:opacity-100" />
      )}
    </li>
  );
}
