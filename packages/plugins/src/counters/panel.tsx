import { localDay } from "@octodo/contract/rules";
import { Button } from "@octodo/ui/components/button";
import { PANE_ROW, PaneHeading } from "@octodo/ui/components/pane";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { useToday } from "@octodo/ui/hooks/use-today";
import { formatTimestamp } from "@octodo/ui/lib/dates";
import { cn } from "@octodo/ui/lib/utils";
import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  CalendarHeartIcon,
  CalendarIcon,
  HistoryIcon,
  TimerResetIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { EntryProps } from "../web.ts";
import { countOf, type CounterFields } from "./count.ts";
import {
  api,
  DayCalendar,
  longDay,
  marks,
  occurrences,
  plural,
  reset,
  setDate,
  unreset,
  useCall,
  weekday,
} from "./common.tsx";

const days = (from: string, to: string) =>
  differenceInCalendarDays(parseISO(localDay(new Date(to))), parseISO(localDay(new Date(from))));

/**
 * The stretches between the times it happened, oldest first: from its creation (or the earliest
 * reset, when one was recorded for before it) to each reset in turn.
 */
function stretches(created: string | null, resets: ReadonlyArray<{ readonly at: string }>) {
  const times = [...(created === null ? [] : [created]), ...resets.map(({ at }) => at)].toSorted();
  return times.slice(1).map((at, index) => ({ at, days: days(times[index]!, at) }));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg leading-tight font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SincePanel({ workspace, entry }: EntryProps<CounterFields>) {
  const today = useToday();
  const count = countOf(entry.fields, today);
  const current = count !== null && "daysSince" in count ? count.daysSince : 0;
  const [resets, setResets] = useState<ReadonlyArray<{ readonly at: string }> | null>(null);
  const [picking, setPicking] = useState(false);
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

  const past = resets === null ? [] : stretches(entry.created, resets);
  const after = new Map(past.map(({ at, days }) => [at, days]));
  const longest = Math.max(current, ...past.map((stretch) => stretch.days));

  return (
    <section aria-label="Resets" className="flex shrink-0 flex-col border-t">
      <PaneHeading
        icon={<TimerResetIcon />}
        label="Days since"
        action={
          <span className="flex items-center gap-0.5">
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    aria-label="It happened on an earlier day"
                    title="It happened on an earlier day"
                    disabled={call.busy}
                  >
                    <CalendarIcon />
                  </Button>
                }
              />
              <PopoverContent align="end" className="w-auto p-0">
                <DayCalendar
                  value={null}
                  past
                  onPick={(day) => {
                    setPicking(false);
                    change(() => reset(workspace, entry.id, day));
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="xs"
              disabled={call.busy}
              onClick={() => change(() => reset(workspace, entry.id))}
            >
              Reset
            </Button>
          </span>
        }
      />
      <div className="grid grid-cols-3 divide-x border-b">
        <Stat label="Current" value={plural(current, "day")} />
        <Stat label="Longest" value={plural(longest, "day")} />
        <Stat label="Resets" value={String(resets?.length ?? 0)} />
      </div>
      {call.error !== null && (
        <p className="border-b px-4 py-2 text-xs text-destructive-foreground">{call.error}</p>
      )}
      <PaneHeading icon={<HistoryIcon />} label="History" count={resets?.length} />
      {resets !== null && resets.length === 0 ? (
        <p className="px-4 py-2.5 text-xs text-muted-foreground">
          Counting since it was created, {formatTimestamp(entry.created)}.
        </p>
      ) : (
        <ScrollArea className="max-h-44">
          <ul aria-label="Resets">
            {resets?.map(({ at }) => (
              <li key={at} className={cn(PANE_ROW, "group/reset text-muted-foreground")}>
                <span className="text-foreground">{formatTimestamp(at)}</span>
                {after.has(at) && (
                  <span className="text-xs tabular-nums">
                    after {plural(after.get(at)!, "day")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="-me-2 ms-auto text-muted-foreground group-hover/reset:opacity-100 focus-visible:opacity-100 md:opacity-0"
                  aria-label={`Take back the reset of ${formatTimestamp(at)}`}
                  title="Take back this reset"
                  disabled={call.busy}
                  onClick={() => change(() => unreset(workspace, entry.id, at))}
                >
                  <Undo2Icon />
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </section>
  );
}

function YearlyPanel({ workspace, entry }: EntryProps<CounterFields>) {
  const today = useToday();
  const [open, setOpen] = useState(false);
  const call = useCall();
  const { date } = entry.fields;
  return (
    <section aria-label="Every year" className="flex shrink-0 flex-col border-t">
      <PaneHeading
        icon={<CalendarHeartIcon />}
        label="Every year"
        action={
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="xs" disabled={call.busy}>
                  <CalendarIcon data-icon="inline-start" />
                  {date === null ? "Set the day" : `Since ${longDay(date)}`}
                </Button>
              }
            />
            <PopoverContent align="end" className="w-auto p-0">
              <DayCalendar
                value={date}
                onPick={(picked) => {
                  setOpen(false);
                  void call.run(() => setDate(workspace, entry.id, picked));
                }}
              />
            </PopoverContent>
          </Popover>
        }
      />
      {call.error !== null && (
        <p className="border-b px-4 py-2 text-xs text-destructive-foreground">{call.error}</p>
      )}
      {date !== null && (
        <ul aria-label="Next times">
          {occurrences(date, today, 3).map(({ next, years }) => {
            const until = differenceInCalendarDays(parseISO(next), parseISO(today));
            return (
              <li key={next} className={cn(PANE_ROW, "hover:bg-transparent")}>
                <span className="w-12 shrink-0 font-medium tabular-nums">{marks(years)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {longDay(next)}
                  <span className="text-muted-foreground"> · {weekday(next)}</span>
                </span>
                <span
                  className={cn(
                    "text-xs text-muted-foreground tabular-nums",
                    until === 0 && "font-medium text-foreground",
                  )}
                >
                  {until === 0 ? "today" : `in ${plural(until, "day")}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Panel(props: EntryProps<CounterFields>) {
  if (props.entry.fields.type === "since") return <SincePanel {...props} />;
  if (props.entry.fields.type === "yearly") return <YearlyPanel {...props} />;
  return null;
}
