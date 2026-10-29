import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@octodo/ui/components/alert-dialog";
import { Badge } from "@octodo/ui/components/badge";
import { Button } from "@octodo/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@octodo/ui/components/empty";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@octodo/ui/components/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { ScrollArea } from "@octodo/ui/components/scroll-area";
import { toastManager } from "@octodo/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";
import { useToday } from "@octodo/ui/hooks/use-today";
import { cn } from "@octodo/ui/lib/utils";
import {
  CalendarIcon,
  MoreHorizontalIcon,
  PanelRightOpenIcon,
  PlusIcon,
  TimerIcon,
  TimerResetIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useState, type ReactNode } from "react";
import { localDay } from "@octodo/contract/rules";
import type { SectionViewProps } from "../web.ts";
import { countOf, type Count, type CounterFields } from "./count.ts";
import {
  type Counter,
  DayCalendar,
  KindIcon,
  longDay,
  marks,
  plural,
  remove,
  reset,
  setDate,
  shortDay,
  unreset,
  useCall,
  weekday,
} from "./common.tsx";
import { NewCounterDialog, TEMPLATES, type Template } from "./new-counter.tsx";

/** Streaks worth reaching; past the last one, every whole year is the next. */
const MILESTONES = [7, 14, 30, 60, 100, 180, 365, 500, 730, 1000];

const milestone = (days: number) => {
  const next = MILESTONES.find((mark) => mark > days) ?? (Math.floor(days / 365) + 1) * 365;
  const previous = Math.max(0, ...[...MILESTONES, next - 365].filter((mark) => mark <= days));
  return { next, progress: (days - previous) / (next - previous) };
};

type Counted = { counter: Counter; count: Count };

/** The view's groups: what comes back each year, soonest first; then the days since, longest first. */
function group(entries: ReadonlyArray<Counter>, today: string) {
  const yearly: Array<Counted & { count: Extract<Count, { next: string }> }> = [];
  const since: Array<Counted & { count: Extract<Count, { daysSince: number }> }> = [];
  const broken: Array<Counter> = [];
  for (const counter of entries) {
    const count = countOf(counter.fields, today);
    if (count === null) broken.push(counter);
    else if ("next" in count) yearly.push({ counter, count });
    else since.push({ counter, count });
  }
  yearly.sort((a, b) => a.count.daysUntil - b.count.daysUntil);
  since.sort((a, b) => b.count.daysSince - a.count.daysSince);
  return { yearly, since, broken };
}

export function View({
  workspace,
  entries,
  view,
  selected,
  onOpen,
  composing,
  onCompose,
}: SectionViewProps<CounterFields>) {
  const today = useToday();
  const [template, setTemplate] = useState<Template>("since");
  const start = (from: Template) => {
    setTemplate(from);
    onCompose(true);
  };
  const { yearly, since, broken } = group(entries, today);
  const card = (counter: Counter, count: Count) => (
    <CounterCard
      key={counter.id}
      workspace={workspace}
      counter={counter}
      count={count}
      active={counter.id === selected}
      onOpen={() => onOpen(counter.id)}
    />
  );

  return (
    <>
      {entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TimerIcon />
            </EmptyMedia>
            <EmptyTitle>
              {view === undefined ? "No counters yet" : `Nothing in ${view.label}`}
            </EmptyTitle>
            <EmptyDescription>
              Count the days since something last happened, or to a day that comes back every year.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {(Object.keys(TEMPLATES) as Array<Template>).map((id) => {
              const { label, Icon } = TEMPLATES[id];
              return (
                <Button key={id} variant="outline" size="sm" onClick={() => start(id)}>
                  <Icon data-icon="inline-start" />
                  {label}
                </Button>
              );
            })}
          </EmptyContent>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="@container mx-auto w-full max-w-5xl px-4 pt-6 pb-24 md:px-6">
            {yearly.length > 0 && (
              <Group
                title="Coming up"
                count={yearly.length}
                onAdd={() => start("birthday")}
                addLabel="New birthday or anniversary"
              >
                {yearly.map(({ counter, count }) => card(counter, count))}
              </Group>
            )}
            {since.length > 0 && (
              <Group
                title="Days since"
                count={since.length}
                onAdd={() => start("since")}
                addLabel="New days-since counter"
              >
                {since.map(({ counter, count }) => card(counter, count))}
              </Group>
            )}
            {broken.length > 0 && (
              <Group title="Can't count" count={broken.length}>
                {broken.map((counter) => (
                  <BrokenCard
                    key={counter.id}
                    counter={counter}
                    active={counter.id === selected}
                    onOpen={() => onOpen(counter.id)}
                  />
                ))}
              </Group>
            )}
          </div>
        </ScrollArea>
      )}
      <NewCounterDialog
        workspace={workspace}
        open={composing}
        template={template}
        onTemplate={setTemplate}
        onOpenChange={onCompose}
        onCreated={onOpen}
      />
    </>
  );
}

function Group({
  title,
  count,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  count: number;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex h-7 items-center gap-2 text-sm font-medium">
        {title}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
        {onAdd && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ms-auto text-muted-foreground"
                  aria-label={addLabel}
                  onClick={onAdd}
                >
                  <PlusIcon />
                </Button>
              }
            />
            <TooltipContent>{addLabel}</TooltipContent>
          </Tooltip>
        )}
      </h2>
      <ul className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">{children}</ul>
    </section>
  );
}

const CARD =
  "group/card relative flex flex-col rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-150 ease-out [@media(hover:hover)]:hover:border-foreground/16 data-active:border-foreground/30 data-active:ring-1 data-active:ring-foreground/30";

/** The card's title, a button whose hit area covers the card; the card's controls sit above it. */
function OpenTitle({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full truncate text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
    >
      {title}
    </button>
  );
}

/** The big number, which slides when it changes (a reset takes it back to 0). */
function Figure({ value, unit }: { value: string; unit: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span className="relative overflow-hidden text-4xl leading-none font-semibold tracking-tight tabular-nums">
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={value}
            className="inline-block"
            initial={{ y: "60%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-60%", opacity: 0 }}
            transition={{ type: "spring", stiffness: 520, damping: 40 }}
          >
            {value}
          </m.span>
        </AnimatePresence>
      </span>
      <span className="text-sm text-muted-foreground">{unit}</span>
    </p>
  );
}

function Meter({ value, label }: { value: number; label: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <m.div
          className="h-full rounded-full bg-foreground/70"
          initial={false}
          animate={{ x: `${Math.max(2, Math.min(100, value * 100)) - 100}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 40 }}
        />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{label}</p>
    </div>
  );
}

function CounterCard({
  workspace,
  counter,
  count,
  active,
  onOpen,
}: {
  workspace: string;
  counter: Counter;
  count: Count;
  active: boolean;
  onOpen: () => void;
}) {
  const call = useCall();
  const [picking, setPicking] = useState(false);
  const isToday = "next" in count && count.daysUntil === 0;

  const resetAt = async (at?: string) => {
    const updated = await call.run(() => reset(workspace, counter.id, at));
    const last = updated?.fields.last;
    if (last == null) return;
    toastManager.add({
      type: "success",
      title: `Reset ${counter.title}`,
      description: at === undefined ? "Counting from now." : `Counting from ${longDay(at)}.`,
      actionProps: {
        children: "Undo",
        onClick: () => void call.run(() => unreset(workspace, counter.id, last)),
      },
    });
  };

  return (
    <li data-active={active || undefined} className={cn(CARD, isToday && "border-foreground/30")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            isToday && "bg-primary text-primary-foreground",
          )}
        >
          <KindIcon type={counter.fields.type} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <OpenTitle title={counter.title} onOpen={onOpen} />
          <p className="truncate text-xs text-muted-foreground">
            {"next" in count
              ? `${marks(count.years)} on ${shortDay(count.next)}, a ${weekday(count.next)}`
              : counter.fields.since === null
                ? ""
                : `since ${longDay(localDay(new Date(counter.fields.since)))}`}
          </p>
        </div>
        <CardMenu
          workspace={workspace}
          counter={counter}
          onOpen={onOpen}
          onReset={() => void resetAt()}
        />
      </div>

      <div className="mt-5 mb-4">
        {"next" in count ? (
          isToday ? (
            <Figure value="Today" unit={count.years === 0 ? "" : `the ${marks(count.years)}`} />
          ) : (
            <Figure
              value={String(count.daysUntil)}
              unit={count.daysUntil === 1 ? "day to go" : "days to go"}
            />
          )
        ) : (
          <Figure value={String(count.daysSince)} unit={count.daysSince === 1 ? "day" : "days"} />
        )}
      </div>

      <div className="mt-auto flex items-end gap-3">
        <div className="min-w-0 flex-1">
          {"next" in count ? (
            <Meter
              value={1 - count.daysUntil / 365}
              label={
                isToday
                  ? "Comes back next year"
                  : count.years === 0
                    ? "Not here yet"
                    : `${plural(365 - count.daysUntil, "day")} since the last one`
              }
            />
          ) : (
            <MilestoneMeter days={count.daysSince} />
          )}
        </div>
        {/* Above the title's hit area, so a click here does not open the panel. */}
        <div className="relative z-[1] flex shrink-0 items-center gap-1">
          {counter.fields.type === "since" ? (
            <>
              <Button
                variant="outline"
                size="xs"
                disabled={call.busy}
                onClick={() => void resetAt()}
              >
                <TimerResetIcon data-icon="inline-start" />
                Reset
              </Button>
              <Popover open={picking} onOpenChange={setPicking}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground"
                            aria-label="It happened on an earlier day"
                            disabled={call.busy}
                          >
                            <CalendarIcon />
                          </Button>
                        }
                      />
                    }
                  />
                  <TooltipContent>It happened on an earlier day</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" className="w-auto p-0">
                  <DayCalendar
                    value={null}
                    past
                    onPick={(day) => {
                      setPicking(false);
                      void resetAt(day);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </>
          ) : (
            <Popover open={picking} onOpenChange={setPicking}>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground"
                    disabled={call.busy}
                  >
                    <CalendarIcon data-icon="inline-start" />
                    {counter.fields.date === null ? "Set day" : longDay(counter.fields.date)}
                  </Button>
                }
              />
              <PopoverContent align="end" className="w-auto p-0">
                <DayCalendar
                  value={counter.fields.date}
                  onPick={(date) => {
                    setPicking(false);
                    void call.run(() => setDate(workspace, counter.id, date));
                  }}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
      {call.error !== null && (
        <p className="mt-2 truncate text-xs text-destructive-foreground" title={call.error}>
          {call.error}
        </p>
      )}
    </li>
  );
}

function MilestoneMeter({ days }: { days: number }) {
  const { next, progress } = milestone(days);
  return (
    <Meter value={progress} label={`${plural(next - days, "day")} to ${plural(next, "day")}`} />
  );
}

/** A counter whose type or date the file gets wrong: the diagnostic says how to fix it. */
function BrokenCard({
  counter,
  active,
  onOpen,
}: {
  counter: Counter;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <li data-active={active || undefined} className={cn(CARD, "border-destructive/24")}>
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/8 text-destructive-foreground">
          <TriangleAlertIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <OpenTitle title={counter.title} onOpen={onOpen} />
          <p className="text-xs text-muted-foreground">
            {counter.fields.type === null
              ? "Its type is not since or yearly."
              : "Its date is not a day."}
          </p>
        </div>
        <Badge variant="outline" size="sm" className="font-mono">
          {counter.id}
        </Badge>
      </div>
    </li>
  );
}

function CardMenu({
  workspace,
  counter,
  onOpen,
  onReset,
}: {
  workspace: string;
  counter: Counter;
  onOpen: () => void;
  onReset: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const deleteCounter = () =>
    remove(workspace, counter.id).catch((cause: unknown) =>
      toastManager.add({
        type: "error",
        title: `Couldn't delete ${counter.title}`,
        description: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="relative z-[1] -me-1.5 -mt-0.5 text-muted-foreground opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
              aria-label={`More actions for ${counter.title}`}
            >
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onOpen}>
              <PanelRightOpenIcon />
              Open
            </DropdownMenuItem>
            {counter.fields.type === "since" && (
              <DropdownMenuItem onClick={onReset}>
                <TimerResetIcon />
                Reset now
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
              <Trash2Icon />
              Delete counter
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {counter.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes its folder, its history of resets and its notes. Tasks that link to it
              lose the link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() => void deleteCounter()}
            >
              Delete counter
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
