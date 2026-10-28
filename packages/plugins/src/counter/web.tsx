import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import { Button } from "@octodo/ui/components/button";
import { Field, FieldError } from "@octodo/ui/components/field";
import { InputGroup, InputGroupInput } from "@octodo/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { formatTimestamp } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { HistoryIcon, RotateCcwIcon, TimerResetIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { KindProps, PluginWeb, TaskOf } from "../web.ts";
import { counted, daysText } from "./days.ts";
import type { CounterFields, counterShared } from "./shared.ts";

const api = createClient<ServedApi<typeof counterShared.operations>>("");

/** Runs one call at a time and keeps its error to show. */
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
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
};

const resetAt = (workspace: string, id: string, at?: string) =>
  api.request("POST /api/workspaces/:workspace/counters/:id/resets", {
    params: { workspace, id },
    payload: at === undefined ? {} : { at },
  });

/** The minute now as a `datetime-local` input writes it. */
const localMinute = (date = new Date()) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Row({
  task,
  className,
}: {
  readonly task: TaskOf<CounterFields>;
  readonly className?: string | undefined;
}) {
  const { current, best } = counted(task.kind.fields);
  const { since } = task.kind.fields;
  const title =
    current === null || since === null
      ? "Not started"
      : `${daysText(current)} since ${formatTimestamp(since)} · best ${daysText(best)}`;
  return (
    <span
      title={title}
      className={cn(
        "flex shrink-0 items-center justify-end gap-1 font-mono text-xs text-foreground/80",
        className,
        "w-auto min-w-14",
      )}
    >
      <TimerResetIcon aria-label="Days since" className="size-3 shrink-0" />
      {current === null ? "—" : `${current}d`}
    </span>
  );
}

function EarlierReset({ workspace, task }: KindProps<CounterFields>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { busy, error, run } = useCall();

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => resetAt(workspace, task.id, draft))) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setDraft(localMinute());
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal">
          <HistoryIcon data-icon="inline-start" />
          Earlier…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-72 p-1.5">
        <form onSubmit={(event) => void save(event)}>
          <Field data-invalid={error !== null || undefined} className="gap-1.5">
            <div className="flex gap-1.5">
              <InputGroup>
                <InputGroupInput
                  autoFocus
                  type="datetime-local"
                  aria-label="When it happened"
                  aria-invalid={error !== null || undefined}
                  max={localMinute()}
                  value={draft}
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </InputGroup>
              <Button type="submit" size="sm" disabled={busy || draft === ""}>
                Reset
              </Button>
            </div>
            <FieldError className="px-1 text-xs">{error}</FieldError>
          </Field>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function Panel({ workspace, task }: KindProps<CounterFields>) {
  const { since, resets, recent } = task.kind.fields;
  const { current, best } = counted(task.kind.fields);
  const { busy, error, run } = useCall();
  const remove = (at: string) =>
    run(() =>
      api.request("DELETE /api/workspaces/:workspace/counters/:id/resets/:at", {
        params: { workspace, id: task.id, at },
      }),
    );

  return (
    <section aria-label="Days since" className="flex shrink-0 flex-col border-t pt-1.5 pb-2">
      <h2 className="flex h-7 shrink-0 items-center gap-2 px-4 font-mono text-xs text-muted-foreground lowercase">
        days since
        <span className="text-muted-foreground/70">{resets}</span>
      </h2>
      <div className="flex items-baseline gap-2 px-4">
        <span className="font-mono text-2xl tabular-nums">{current ?? "—"}</span>
        <span className="text-sm text-muted-foreground">
          {current === null || since === null
            ? "not started"
            : `${current === 1 ? "day" : "days"} since ${formatTimestamp(since)}`}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          best {daysText(best)}
        </span>
      </div>
      <div className="flex items-center gap-1 px-4 pt-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => resetAt(workspace, task.id))}
        >
          <RotateCcwIcon data-icon="inline-start" />
          Reset now
        </Button>
        <EarlierReset workspace={workspace} task={task} />
      </div>
      {error !== null && <p className="px-4 pt-1 text-xs text-destructive">{error}</p>}
      {recent.length > 0 && (
        <ul aria-label="Resets" className="flex flex-col px-4 pt-1">
          {recent.map((at) => (
            <li
              key={at}
              className="group flex h-6 items-center font-mono text-xs text-muted-foreground"
            >
              reset {formatTimestamp(at)}
              <Button
                variant="ghost"
                size="icon-xs"
                className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`Take back the reset of ${formatTimestamp(at)}`}
                disabled={busy}
                onClick={() => void remove(at)}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A counter closes like any task: completing it is not a reset (decision 0019). */
export const counterWeb: PluginWeb<CounterFields, null> = {
  Row,
  Panel,
  completesInPlace: false,
  create: {
    noun: "Days-since counter",
    Icon: TimerResetIcon,
    empty: null,
    ready: () => true,
    create: (workspace, task) =>
      api.request("POST /api/workspaces/:workspace/counters", {
        params: { workspace },
        payload: task,
      }),
  },
};
