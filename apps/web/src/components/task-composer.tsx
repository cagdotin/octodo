import type { CreateTaskInput, WorkspaceSnapshot } from "@octodo/core";
import { useState, type FormEvent } from "react";
import { PriorityIcon, StatusIcon, TagChip } from "@/components/task-bits";
import { Kbd } from "@/components/ui/kbd";
import { useCreateTask } from "@/lib/api";
import { cn } from "@/lib/utils";
import { dueInfo, isSmartView, parseQuickAdd, SMART, todayKey } from "@/lib/tasks";

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
 * closes it. Understands the quick-add tokens `!high`, `#tag` and `due:`.
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
  const [text, setText] = useState("");
  const create = useCreateTask(workspace);
  const parsed = parseQuickAdd(text);
  const category = snapshot.statuses.find((entry) => entry.id === status)?.category;
  const due = dueInfo(parsed.due ?? null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed.title === "") return;
    const input: CreateTaskInput = {
      title: parsed.title,
      tags: parsed.tags,
      status,
      ...(parsed.priority ? { priority: parsed.priority } : {}),
      // Adding from Today means due today unless the text says otherwise.
      ...(parsed.due ? { due: parsed.due } : list === SMART.today ? { due: todayKey() } : {}),
      ...(isSmartView(list) ? {} : { list: list ?? null }),
    };
    create.mutate(input);
    setText("");
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex items-center gap-2",
        variant === "row"
          ? "h-9 gap-1.5 rounded-md bg-row-hover pr-3 pl-1.5 md:pl-[18px]"
          : "rounded-lg border bg-card px-3 py-2.5 shadow-xs",
      )}
    >
      <span
        className={cn("flex shrink-0 items-center justify-center", variant === "row" && "size-6")}
      >
        <StatusIcon category={category} />
      </span>
      {variant === "row" && (
        <span
          aria-hidden
          className="box-content hidden shrink-0 pr-2 pl-1 sm:inline"
          style={{ width: idWidth }}
        />
      )}
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose by a click or `n`.
        autoFocus
        aria-label="New task title"
        value={text}
        autoComplete="off"
        enterKeyHint="done"
        placeholder="Task title, then Enter  (!high  #tag  due:tomorrow)"
        className="min-w-0 flex-1 bg-transparent pl-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => text.trim() === "" && onClose()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <span className="flex shrink-0 items-center gap-1.5">
        {parsed.priority && parsed.priority !== "none" && (
          <PriorityIcon priority={parsed.priority} />
        )}
        {parsed.tags.map((tag) => (
          <TagChip key={tag} tag={tag} />
        ))}
        {due && (
          <span className={cn("text-xs", due.overdue ? "text-destructive" : "text-foreground/80")}>
            {due.label}
          </span>
        )}
        {variant === "row" && text === "" && (
          <span className="hidden text-xs text-muted-foreground md:inline">
            <Kbd>Esc</Kbd> to cancel
          </span>
        )}
      </span>
    </form>
  );
}
