import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { Button } from "@octodo/ui/components/button";
import { Field, FieldError } from "@octodo/ui/components/field";
import { InputGroup, InputGroupInput } from "@octodo/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { dueInfo, formatTimestamp } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { RepeatIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { KindProps, PluginWeb, TaskOf } from "../web.ts";
import type { RecurringFields, recurringShared } from "./shared.ts";

const api = createClient<ServedApi<typeof recurringShared.operations>>("");

const ruleText = (repeat: string | null) => repeat ?? "No rule";

function Row({
  task,
  className,
}: {
  readonly task: TaskOf<RecurringFields>;
  readonly className?: string | undefined;
}) {
  const { repeat, next, last } = task.kind.fields;
  const due = dueInfo(next);
  const title = [
    ruleText(repeat),
    next === null ? "no next day" : `next ${next}`,
    last === null ? "never done" : `last done ${formatTimestamp(last)}`,
  ].join(" · ");
  return (
    <span
      title={title}
      className={cn(
        "flex shrink-0 items-center justify-end gap-1 font-mono text-xs text-foreground/80",
        className,
        "w-auto min-w-14",
        due?.today && "text-foreground",
        due?.overdue && "text-destructive",
      )}
    >
      <RepeatIcon aria-label="Repeats" className="size-3 shrink-0" />
      {due?.label ?? "—"}
    </span>
  );
}

function RepeatEditor({ workspace, task }: KindProps<RecurringFields>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(task.kind.fields.repeat ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.request("PATCH /api/workspaces/:workspace/recurring/:id", {
        params: { workspace, id: task.id },
        payload: { repeat: draft },
      });
      setError(null);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setDraft(task.kind.fields.repeat ?? "");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 font-normal"
          aria-label="Change the rule"
        >
          <RepeatIcon data-icon="inline-start" />
          {ruleText(task.kind.fields.repeat)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-72 p-1.5">
        <form onSubmit={(event) => void save(event)}>
          <Field data-invalid={error !== null || undefined} className="gap-1.5">
            <InputGroup>
              <InputGroupInput
                autoFocus
                aria-label="Repeat rule"
                aria-invalid={error !== null || undefined}
                placeholder="every 3 days"
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
              />
            </InputGroup>
            <FieldError className="px-1 text-xs">{error}</FieldError>
          </Field>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Panel({ workspace, task }: KindProps<RecurringFields>) {
  const { next, count, recent } = task.kind.fields;
  const due = dueInfo(next);
  return (
    <section aria-label="Repeats" className="flex shrink-0 flex-col border-t pt-1.5 pb-2">
      <h2 className="flex h-7 shrink-0 items-center gap-2 px-4 font-mono text-xs text-muted-foreground lowercase">
        repeats
        <span className="text-muted-foreground/70">{count}</span>
      </h2>
      <div className="flex items-center gap-2 px-4 text-sm">
        <RepeatEditor workspace={workspace} task={task} />
        <span
          className={cn(
            "ml-auto font-mono text-xs text-muted-foreground",
            due?.today && "text-foreground",
            due?.overdue && "text-destructive",
          )}
        >
          {due === null ? "no next day" : `next ${due.label}`}
        </span>
      </div>
      {recent.length > 0 && (
        <ul aria-label="Done" className="flex flex-col px-4 pt-1">
          {recent.map((at) => (
            <li key={at} className="flex h-6 items-center font-mono text-xs text-muted-foreground">
              done {formatTimestamp(at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const recurringWeb: PluginWeb<RecurringFields> = {
  Row,
  Panel,
  completesInPlace: true,
};
