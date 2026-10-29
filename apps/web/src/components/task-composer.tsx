import type { CreateTaskInput, WorkspaceSnapshot } from "@octodo/contract";
import { useMemo } from "react";
import { QuickAddInput } from "@/components/quick-add/quick-add-input";
import { suggestionsFor, useQuickAdd } from "@/components/quick-add/use-quick-add";
import { PriorityIcon, StatusIcon, TagChip } from "@/components/task-bits";
import { Kbd } from "@octodo/ui/components/kbd";
import { useCreateTask } from "@/lib/api";
import { PANE_ROW } from "@octodo/ui/components/pane";
import { cn } from "@octodo/ui/lib/utils";
import { useToday } from "@octodo/ui/hooks/use-today";
import { dueInfo } from "@octodo/ui/lib/dates";
import { isSmartView, SMART } from "@/lib/tasks";

interface Props {
  workspace: string;
  snapshot: WorkspaceSnapshot;
  /** The status the new task lands in (the group or column it was opened from). */
  status: string;
  /** The current `list` search param: a real list files the task there. */
  list: string | undefined;
  onClose: () => void;
  variant?: "row" | "card";
  /** In a list, the width of the id column, so the row lines up with the tasks below. */
  idWidth?: string;
}

/**
 * Inline new-task row. Enter saves and keeps it open for the next one, Esc (or leaving it empty)
 * closes it. Understands the quick-add tokens (`/list`, `#tag`, `!high`, `due:`, natural dates).
 */
export function TaskComposer({
  workspace,
  snapshot,
  status,
  list,
  onClose,
  variant = "row",
  idWidth,
}: Props) {
  const draft = useQuickAdd(snapshot.lists);
  const suggestions = useMemo(() => suggestionsFor(snapshot), [snapshot]);
  const create = useCreateTask(workspace);
  const { title, fields } = draft.parsed;
  const category = snapshot.statuses.find((entry) => entry.id === status)?.category;
  const today = useToday();
  const due = dueInfo(fields.due ?? null, today);

  const submit = () => {
    if (title === "") return;
    const input: CreateTaskInput = {
      title,
      tags: fields.tags,
      status,
      ...(fields.priority ? { priority: fields.priority } : {}),
      // Adding from Today means due today unless the text says otherwise.
      ...(fields.due ? { due: fields.due } : list === SMART.today ? { due: today } : {}),
      ...(fields.list ? { list: fields.list } : isSmartView(list) ? {} : { list: list ?? null }),
    };
    create.mutate(input);
    draft.setText("");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-center gap-2",
        variant === "row"
          ? cn(PANE_ROW, "bg-accent/60")
          : "rounded-lg border bg-card px-3 py-2.5 shadow-xs",
      )}
    >
      {variant === "row" && (
        <>
          <span aria-hidden className="size-4 shrink-0" />
          <span aria-hidden className="hidden shrink-0 @md:block" style={{ width: idWidth }} />
        </>
      )}
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          variant === "row" && "-mx-1 size-6",
        )}
      >
        <StatusIcon category={category} />
      </span>
      <QuickAddInput
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose by a click or `n`.
        autoFocus
        draft={draft}
        suggestions={suggestions}
        label="New task title"
        placeholder="Task title, then Enter  (/list  #tag  !high  tomorrow)"
        className="min-w-0 flex-1 text-base md:text-[13px]"
        onSubmit={submit}
        onEscape={onClose}
        onBlur={() => draft.text.trim() === "" && onClose()}
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {fields.priority && fields.priority !== "none" && (
          <PriorityIcon priority={fields.priority} />
        )}
        {fields.tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {due && (
          <span className={cn("text-xs", due.overdue ? "text-destructive" : "text-foreground/80")}>
            {due.label}
          </span>
        )}
        {variant === "row" && draft.text === "" && (
          <span className="hidden text-xs text-muted-foreground md:inline">
            <Kbd>Esc</Kbd> to cancel
          </span>
        )}
      </span>
    </form>
  );
}
