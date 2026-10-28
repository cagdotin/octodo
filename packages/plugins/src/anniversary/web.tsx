import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { Button } from "@octodo/ui/components/button";
import { Calendar } from "@octodo/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { PropertyChip } from "@octodo/ui/components/property-chip";
import { useToday } from "@octodo/ui/hooks/use-today";
import { dueInfo } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { CakeIcon } from "lucide-react";
import { useState } from "react";
import type { CreateFieldsProps, KindProps, PluginWeb, TaskOf } from "../web.ts";
import {
  daysBetween,
  nextOccurrence,
  occurrenceDay,
  today,
  type Day,
  type Occurrence,
} from "./day.ts";
import type { AnniversaryFields, anniversaryShared } from "./shared.ts";

const api = createClient<ServedApi<typeof anniversaryShared.operations>>("");

const toDate = (day: Day) => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
};

/** The last month the date picker offers: a wedding can be set before it happens. */
const tenYearsOn = () => new Date(new Date().getFullYear() + 10, 11);

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "65 years", or "first time" on the day itself. */
const yearsText = ({ years }: Occurrence) => (years === 0 ? "first time" : plural(years, "year"));

/** "Today", "Tomorrow" or "in 229 days". */
const untilText = (next: Day, from: Day) => {
  const days = daysBetween(from, next);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${plural(days, "day")}`;
};

/** The next occurrence from `from`: computed here, since the engine's read is cached across days. */
const occurrenceFrom = (date: Day | null, from: Day) => {
  return date === null ? null : { from, ...nextOccurrence(date, from) };
};

function Row({
  task,
  className,
}: {
  readonly task: TaskOf<AnniversaryFields>;
  readonly className?: string | undefined;
}) {
  const from = useToday();
  const occurrence = occurrenceFrom(task.kind.fields.date, from);
  const due = dueInfo(occurrence?.next ?? null, from);
  return (
    <span
      title={
        occurrence === null
          ? "No date"
          : `${yearsText(occurrence)} on ${occurrence.next}, ${untilText(occurrence.next, occurrence.from).toLowerCase()}`
      }
      className={cn(
        "flex shrink-0 items-center justify-end gap-1 font-mono text-xs text-foreground/80",
        className,
        "w-auto min-w-14",
        due?.today && "text-foreground",
      )}
    >
      <CakeIcon aria-label="Anniversary" className="size-3 shrink-0" />
      {due?.label ?? "—"}
    </span>
  );
}

function DateEditor({ workspace, task }: KindProps<AnniversaryFields>) {
  const { date } = task.kind.fields;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const from = useToday();

  const save = async (day: Day) => {
    setSaving(true);
    try {
      await api.request("PATCH /api/workspaces/:workspace/anniversaries/:id", {
        params: { workspace, id: task.id },
        payload: { date: day },
      });
      setError(null);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const selected = date === null ? undefined : toDate(date);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 font-normal"
          aria-label="Change the date"
        >
          <CakeIcon data-icon="inline-start" />
          {date === null ? "No date" : (dueInfo(date, from)?.label ?? date)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-fit gap-1.5 p-2">
        <Calendar
          mode="single"
          required
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={tenYearsOn()}
          className="p-0 [--cell-size:--spacing(8)]"
          selected={selected}
          {...(selected === undefined ? {} : { defaultMonth: selected })}
          disabled={saving}
          onSelect={(picked) => void save(today(picked))}
        />
        {error !== null && (
          <p role="alert" className="px-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface Draft {
  readonly date: Day | null;
}

/** The date chip; it opens when Anniversary is picked, since an anniversary needs its day. */
function CreateFields({ draft, onChange, onCloseAutoFocus }: CreateFieldsProps<Draft>) {
  const [open, setOpen] = useState(true);
  const from = useToday();
  const selected = draft.date === null ? undefined : toDate(draft.date);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PropertyChip set={draft.date !== null}>
          {draft.date === null ? (
            "First happened"
          ) : (
            <span className="font-mono">{dueInfo(draft.date, from)?.label ?? draft.date}</span>
          )}
        </PropertyChip>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-fit p-2"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Calendar
          mode="single"
          required
          autoFocus
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={tenYearsOn()}
          className="p-0 [--cell-size:--spacing(8)]"
          selected={selected}
          {...(selected === undefined ? {} : { defaultMonth: selected })}
          onSelect={(picked) => {
            onChange({ date: today(picked) });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Panel({ workspace, task }: KindProps<AnniversaryFields>) {
  const occurrence = occurrenceFrom(task.kind.fields.date, useToday());
  return (
    <section aria-label="Anniversary" className="flex shrink-0 flex-col border-t pt-1.5 pb-2">
      <h2 className="flex h-7 shrink-0 items-center gap-2 px-4 font-mono text-xs text-muted-foreground lowercase">
        anniversary
      </h2>
      <div className="flex items-center gap-2 px-4 text-sm">
        <DateEditor workspace={workspace} task={task} />
        <span
          className={cn(
            "ml-auto font-mono text-xs text-muted-foreground",
            occurrence?.next === occurrence?.from && "text-foreground",
          )}
        >
          {occurrence === null
            ? "no next day"
            : `${yearsText(occurrence)} ${untilText(occurrence.next, occurrence.from).toLowerCase()}`}
        </span>
      </div>
    </section>
  );
}

export const anniversaryWeb: PluginWeb<AnniversaryFields, Draft> = {
  Row,
  Panel,
  day: occurrenceDay,
  completesInPlace: false,
  create: {
    noun: "Anniversary",
    Icon: CakeIcon,
    empty: { date: null },
    Fields: CreateFields,
    ready: ({ date }) => date !== null,
    create: (workspace, task, { date }) =>
      api.request("POST /api/workspaces/:workspace/anniversaries", {
        params: { workspace },
        payload: { ...task, date: date ?? "" },
      }),
  },
};
