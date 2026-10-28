import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { Button } from "@octodo/ui/components/button";
import { Calendar } from "@octodo/ui/components/calendar";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@octodo/ui/components/empty";
import { Kbd } from "@octodo/ui/components/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { PropertyChip } from "@octodo/ui/components/property-chip";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@octodo/ui/components/toggle-group";
import { useToday } from "@octodo/ui/hooks/use-today";
import { formatTimestamp } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { format, parseISO } from "date-fns";
import {
  CalendarHeartIcon,
  type LucideIcon,
  PlusIcon,
  TimerIcon,
  TimerResetIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EntryOf, EntryProps, SectionViewProps, SectionWeb } from "../web.ts";
import { countOf, counterDay, type CounterFields, type CounterType } from "./count.ts";
import type { countersShared } from "./shared.ts";

const api = createClient<ServedApi<typeof countersShared.operations>>("");

type Counter = EntryOf<CounterFields>;

const KIND: Record<CounterType, { readonly label: string; readonly Icon: LucideIcon }> = {
  since: { label: "Since", Icon: TimerResetIcon },
  yearly: { label: "Yearly", Icon: CalendarHeartIcon },
};

/** A counter's kind's icon; the section's own for a counter whose type is unreadable. */
function KindIcon({
  type,
  className,
}: {
  type: CounterType | null;
  className?: string | undefined;
}) {
  const Icon = type === null ? TimerIcon : KIND[type].Icon;
  return <Icon aria-label={type === null ? "Counter" : KIND[type].label} className={className} />;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const longDay = (day: string) => format(parseISO(day), "MMM d, yyyy");

/** A next occurrence, always within a year of today, so "in N days" beside it names the year. */
const nextDay = (day: string) => format(parseISO(day), "MMM d");

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Runs one call at a time and keeps its error, for a button that changes a counter. */
const useCall = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (call: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await call();
      setError(null);
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
};

const reset = (workspace: string, id: string) =>
  api.request("POST /api/workspaces/:workspace/counters/:id/resets", {
    params: { workspace, id },
    payload: {},
  });

/** A day picker for a yearly counter's first day, with month and year menus to reach 1961. */
function DayCalendar({ value, onPick }: { value: string | null; onPick: (day: string) => void }) {
  const today = parseISO(useToday());
  const selected = value === null ? today : parseISO(value);
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      startMonth={new Date(1900, 0)}
      endMonth={new Date(today.getFullYear() + 10, 11)}
      defaultMonth={selected}
      {...(value === null ? {} : { selected })}
      onSelect={(date) => date && onPick(format(date, "yyyy-MM-dd"))}
    />
  );
}

const ROW = "group/row relative flex h-9 items-center gap-1.5 rounded-md pr-3 pl-1.5 md:pl-[18px]";

/** The kind's icon where a task row has its status, so the two lists line up. */
function Lead({ type }: { type: CounterType | null }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
      <KindIcon type={type} className="size-3.5" />
    </span>
  );
}

function IdCell({ id, width }: { id: string; width: string }) {
  return (
    <span
      className="box-content hidden shrink-0 pr-2 pl-1 font-mono text-xs text-muted-foreground sm:inline"
      style={{ width }}
    >
      {id}
    </span>
  );
}

/** What a counter shows at the end of its row: the days since, or when it comes back. */
function CountCells({ counter, today }: { counter: Counter; today: string }) {
  const count = countOf(counter.fields, today);
  if (count === null)
    return (
      <span className="w-24 shrink-0 text-right font-mono text-xs text-destructive">
        {counter.fields.type === null ? "no type" : "no date"}
      </span>
    );
  if ("daysSince" in count)
    return (
      <span className="w-24 shrink-0 text-right font-mono text-xs text-foreground/80 tabular-nums">
        {plural(count.daysSince, "day")}
      </span>
    );
  return (
    <>
      <span className="hidden shrink-0 font-mono text-xs text-muted-foreground tabular-nums @lg:inline">
        {count.years === 0 ? "first" : plural(count.years, "year")}
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-xs text-foreground/80">
        {nextDay(count.next)}
      </span>
      <span
        className={cn(
          "w-24 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums",
          count.daysUntil === 0 && "text-foreground",
        )}
      >
        {count.daysUntil === 0 ? "today" : `in ${plural(count.daysUntil, "day")}`}
      </span>
    </>
  );
}

function CounterRow({
  workspace,
  counter,
  active,
  idWidth,
  onOpen,
}: {
  workspace: string;
  counter: Counter;
  active: boolean;
  idWidth: string;
  onOpen: () => void;
}) {
  const today = useToday();
  const call = useCall();
  return (
    <li
      data-active={active || undefined}
      className={cn(
        ROW,
        "transition-colors hover:bg-row-hover data-active:rounded-l-none data-active:bg-accent data-active:shadow-[inset_2px_0_0_var(--ink)]",
      )}
    >
      <Lead type={counter.fields.type} />
      <IdCell id={counter.id} width={idWidth} />
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 truncate pl-1 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
      >
        {counter.title}
      </button>
      {call.error !== null && (
        <span title={call.error} className="relative truncate text-xs text-destructive">
          {call.error}
        </span>
      )}
      {counter.fields.type === "since" && (
        <Button
          variant="ghost"
          size="xs"
          disabled={call.busy}
          className="relative text-muted-foreground group-hover/row:opacity-100 focus-visible:opacity-100 md:opacity-0"
          onClick={() => void call.run(() => reset(workspace, counter.id))}
        >
          <TimerResetIcon data-icon="inline-start" />
          Reset
        </Button>
      )}
      <CountCells counter={counter} today={today} />
    </li>
  );
}

/**
 * The new-counter row: a title, the kind, and a yearly counter's first day. Enter creates and keeps
 * the row open for the next; Esc closes it. Picking Yearly opens the day picker at once, since a
 * yearly counter needs its day (as a kind's picker does in the new-task dialog, 0023).
 */
function Composer({
  workspace,
  idWidth,
  onClose,
}: {
  workspace: string;
  idWidth: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<CounterType>("since");
  const [date, setDate] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const call = useCall();

  const submit = async () => {
    if (title.trim() === "") return input.current?.focus();
    if (type === "yearly" && date === null) return setPicking(true);
    const created = await call.run(() =>
      api.request("POST /api/workspaces/:workspace/counters", {
        params: { workspace },
        payload: { title: title.trim(), type, ...(type === "yearly" && date ? { date } : {}) },
      }),
    );
    if (created) {
      setTitle("");
      setDate(null);
      input.current?.focus();
    }
  };

  return (
    <form
      aria-label="New counter"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className={cn(ROW, "bg-row-hover")}
    >
      <Lead type={type} />
      <span
        aria-hidden
        className="box-content hidden shrink-0 pr-2 pl-1 font-mono text-xs sm:inline"
        style={{ width: idWidth }}
      />
      <input
        ref={input}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose by a click or `n`.
        autoFocus
        aria-label="New counter title"
        placeholder={
          type === "since" ? "Days since…, then Enter" : "Whose birthday, or what anniversary…"
        }
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="min-w-0 flex-1 bg-transparent pl-1 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
      {call.error !== null && (
        <span title={call.error} className="max-w-60 truncate text-xs text-destructive">
          {call.error}
        </span>
      )}
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        aria-label="Kind"
        value={type}
        onValueChange={(value) => {
          if (value !== "since" && value !== "yearly") return;
          setType(value);
          if (value === "yearly" && date === null) setPicking(true);
        }}
      >
        {(["since", "yearly"] as const).map((value) => (
          <ToggleGroupItem key={value} value={value} className="px-2 text-xs">
            {KIND[value].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {type === "yearly" && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <PropertyChip set={date !== null}>
              {date === null ? "Date" : longDay(date)}
            </PropertyChip>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={8}
            className="w-auto p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              input.current?.focus();
            }}
          >
            <DayCalendar
              value={date}
              onPick={(day) => {
                setDate(day);
                setPicking(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
        <Kbd>Esc</Kbd> to cancel
      </span>
    </form>
  );
}

function View({
  workspace,
  entries,
  selected,
  onOpen,
  composing,
  onCompose,
}: SectionViewProps<CounterFields>) {
  const idWidth = `${Math.max(4, ...entries.map((entry) => entry.id.length))}ch`;

  if (entries.length === 0 && !composing) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TimerIcon />
          </EmptyMedia>
          <EmptyTitle>No counters</EmptyTitle>
          <EmptyDescription>
            Count the days since something last happened, or to a day that comes back every year.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" size="sm" onClick={() => onCompose(true)}>
            <PlusIcon data-icon="inline-start" />
            New counter
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="@container flex flex-col px-2 pt-1 pb-24 md:px-3">
        <div className="group/header relative flex h-9 items-center gap-2.5 pl-1 md:pl-[23px]">
          <span className="font-mono text-xs text-muted-foreground lowercase">counters</span>
          <span className="font-mono text-xs text-muted-foreground/70">{entries.length}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-1.5 text-muted-foreground opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
            aria-label="New counter"
            onClick={() => onCompose(true)}
          >
            <PlusIcon />
          </Button>
        </div>
        {composing && (
          <Composer workspace={workspace} idWidth={idWidth} onClose={() => onCompose(false)} />
        )}
        <ul className="flex flex-col">
          {entries.map((counter) => (
            <CounterRow
              key={counter.id}
              workspace={workspace}
              counter={counter}
              active={counter.id === selected}
              idWidth={idWidth}
              onOpen={() => onOpen(counter.id)}
            />
          ))}
        </ul>
      </div>
    </ScrollArea>
  );
}

/** A section of the entry panel, headed like the task panel's "repeats". */
function PanelSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex shrink-0 flex-col border-t pt-1.5 pb-2">
      <h2 className="flex h-7 shrink-0 items-center gap-2 px-4 font-mono text-xs text-muted-foreground lowercase">
        {label}
        {count !== undefined && <span className="text-muted-foreground/70">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

/** A since counter's count, its Reset, and every reset with a way to take it back. */
function SincePanel({ workspace, entry }: EntryProps<CounterFields>) {
  const today = useToday();
  const count = countOf(entry.fields, today);
  const [resets, setResets] = useState<ReadonlyArray<{ readonly at: string }> | null>(null);
  const call = useCall();

  const load = () =>
    api
      .request("GET /api/workspaces/:workspace/counters/:id/resets", {
        params: { workspace, id: entry.id },
      })
      .then(setResets);

  useEffect(() => {
    void call.run(load);
  }, [workspace, entry.id, entry.fields.last]);

  const change = (request: () => Promise<unknown>) =>
    void call.run(async () => {
      await request();
      await load();
    });

  return (
    <PanelSection label="resets" count={resets?.length}>
      <div className="flex items-center gap-2 px-4 text-sm">
        <span className="font-mono text-xs text-foreground/80">
          {count === null || !("daysSince" in count)
            ? "nothing to count from"
            : entry.fields.last === null
              ? `${plural(count.daysSince, "day")} since it was created`
              : plural(count.daysSince, "day")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 ml-auto"
          disabled={call.busy}
          onClick={() => change(() => reset(workspace, entry.id))}
        >
          <TimerResetIcon data-icon="inline-start" />
          Reset
        </Button>
      </div>
      {call.error !== null && <p className="px-4 text-xs text-destructive">{call.error}</p>}
      {resets !== null && resets.length > 0 && (
        <ScrollArea className="max-h-36">
          <ul aria-label="Resets" className="flex flex-col px-4 pt-1">
            {resets.map(({ at }) => (
              <li
                key={at}
                className="group/reset flex h-6 items-center font-mono text-xs text-muted-foreground"
              >
                reset {formatTimestamp(at)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1.5 ml-auto text-muted-foreground group-hover/reset:opacity-100 focus-visible:opacity-100 md:opacity-0"
                  aria-label={`Take back the reset of ${formatTimestamp(at)}`}
                  title="Take back this reset"
                  disabled={call.busy}
                  onClick={() =>
                    change(() =>
                      api.request("DELETE /api/workspaces/:workspace/counters/:id/resets/:at", {
                        params: { workspace, id: entry.id, at },
                      }),
                    )
                  }
                >
                  <Undo2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </PanelSection>
  );
}

/** A yearly counter's first day, which a calendar changes, and when it comes back. */
function YearlyPanel({ workspace, entry }: EntryProps<CounterFields>) {
  const today = useToday();
  const count = countOf(entry.fields, today);
  const [open, setOpen] = useState(false);
  const call = useCall();
  return (
    <PanelSection label="yearly">
      <div className="flex items-center gap-2 px-4 text-sm">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 font-normal" disabled={call.busy}>
              <CalendarHeartIcon data-icon="inline-start" />
              {entry.fields.date === null ? "Set the day" : longDay(entry.fields.date)}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" collisionPadding={8} className="w-auto p-0">
            <DayCalendar
              value={entry.fields.date}
              onPick={(date) => {
                setOpen(false);
                void call.run(() =>
                  api.request("PATCH /api/workspaces/:workspace/counters/:id", {
                    params: { workspace, id: entry.id },
                    payload: { date },
                  }),
                );
              }}
            />
          </PopoverContent>
        </Popover>
        {count !== null && "next" in count && (
          <span
            className={cn(
              "ml-auto font-mono text-xs text-muted-foreground",
              count.daysUntil === 0 && "text-foreground",
            )}
          >
            {count.years === 0 ? "first" : plural(count.years, "year")} on {nextDay(count.next)},{" "}
            {count.daysUntil === 0 ? "today" : `in ${plural(count.daysUntil, "day")}`}
          </span>
        )}
      </div>
      {call.error !== null && <p className="px-4 text-xs text-destructive">{call.error}</p>}
    </PanelSection>
  );
}

function Panel(props: EntryProps<CounterFields>) {
  if (props.entry.fields.type === "since") return <SincePanel {...props} />;
  if (props.entry.fields.type === "yearly") return <YearlyPanel {...props} />;
  return null;
}

/** The counters section's web half (decision 0027). */
export const countersWeb: SectionWeb<CounterFields> = {
  label: "Counters",
  noun: "counter",
  Icon: TimerIcon,
  EntryIcon: ({ fields, className }) => <KindIcon type={fields.type} className={className} />,
  View,
  Panel,
  edit: (workspace, id, patch) =>
    api.request("PATCH /api/workspaces/:workspace/counters/:id", {
      params: { workspace, id },
      payload: patch,
    }),
  remove: (workspace, id) =>
    api.request("DELETE /api/workspaces/:workspace/counters/:id", { params: { workspace, id } }),
  day: counterDay,
};
