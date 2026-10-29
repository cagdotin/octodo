import { Button } from "@octodo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@octodo/ui/components/dialog";
import { Field, FieldLabel } from "@octodo/ui/components/field";
import { Input } from "@octodo/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { RadioGroupPrimitive, RadioPrimitive } from "@octodo/ui/components/radio-group";
import { Spinner } from "@octodo/ui/components/spinner";
import { useToday } from "@octodo/ui/hooks/use-today";
import { cn } from "@octodo/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { TEMPLATES, type Template } from "./common.ts";
import { countOf, type CounterType } from "./count.ts";
import { api, longDay, marks, plural, reset, shortDay, useCall } from "./common.ts";
import { DayCalendar } from "./parts.tsx";

const isTemplate = (value: unknown): value is Template =>
  typeof value === "string" && value in TEMPLATES;

/** What the counter will show, worked out as the engine will once it exists. */
function preview(type: CounterType, day: string | null, today: string) {
  if (type === "since") {
    const since = day === null ? new Date().toISOString() : `${day}T12:00:00`;
    const count = countOf({ type, since, last: null, date: null }, today);
    return count !== null && "daysSince" in count && count.daysSince > 0
      ? `Starts at ${plural(count.daysSince, "day")}.`
      : "Starts at 0 days and counts up from today.";
  }
  if (day === null) return "Pick the day, and it comes back every year.";
  const count = countOf({ type, since: null, last: null, date: day }, today);
  if (count === null || !("next" in count)) return "";
  const when = count.daysUntil === 0 ? "today" : `in ${plural(count.daysUntil, "day")}`;
  return `${marks(count.years)} on ${shortDay(count.next)}, ${when}.`;
}

export function NewCounterDialog({
  workspace,
  open,
  template,
  onTemplate,
  onOpenChange,
  onCreated,
}: {
  workspace: string;
  open: boolean;
  template: Template;
  onTemplate: (template: Template) => void;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const today = useToday();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const call = useCall();
  const chosen = TEMPLATES[template];
  const ready = title.trim() !== "" && (chosen.type === "since" || day !== null);

  const close = () => {
    onOpenChange(false);
    setTitle("");
    setDay(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const created = await call.run(async () => {
      const counter = await api.request("POST /api/workspaces/:workspace/counters", {
        params: { workspace },
        payload: {
          title: title.trim(),
          type: chosen.type,
          ...(chosen.type === "yearly" && day !== null ? { date: day } : {}),
        },
      });
      if (chosen.type === "since" && day !== null) await reset(workspace, counter.id, day);
      return counter;
    });
    if (created === undefined) return;
    close();
    onCreated(created.id);
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>New counter</DialogTitle>
            <DialogDescription>
              Count the days since something happened, or to a day that comes back every year.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="flex flex-col gap-5">
            <RadioGroupPrimitive
              aria-label="Kind of counter"
              className="grid grid-cols-3 gap-2"
              value={template}
              onValueChange={(value) => {
                if (!isTemplate(value)) return;
                if (TEMPLATES[value].type !== chosen.type) setDay(null);
                onTemplate(value);
              }}
            >
              {(Object.keys(TEMPLATES) as Array<Template>).map((id) => {
                const { label, hint, Icon } = TEMPLATES[id];
                return (
                  <RadioPrimitive.Root
                    key={id}
                    value={id}
                    className="group flex cursor-pointer flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left outline-none transition-[border-color,box-shadow,scale] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] data-checked:border-foreground/40 data-checked:ring-1 data-checked:ring-foreground/40 [@media(hover:hover)]:hover:not-data-checked:border-foreground/16"
                  >
                    <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-data-checked:bg-primary group-data-checked:text-primary-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                    <span className="text-xs leading-snug text-pretty text-muted-foreground">
                      {hint}
                    </span>
                  </RadioPrimitive.Root>
                );
              })}
            </RadioGroupPrimitive>

            <Field>
              <FieldLabel htmlFor="counter-title">Title</FieldLabel>
              <Input
                id="counter-title"
                autoFocus
                placeholder={chosen.placeholder}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel>{chosen.day}</FieldLabel>
              <Popover open={picking} onOpenChange={setPicking}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        "w-full justify-start font-normal",
                        day === null && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon data-icon="inline-start" />
                      {day !== null
                        ? longDay(day)
                        : chosen.type === "since"
                          ? "Today, now"
                          : "Pick a day"}
                    </Button>
                  }
                />
                <PopoverContent align="start" className="w-auto p-0">
                  <DayCalendar
                    value={day}
                    past={chosen.type === "since"}
                    onPick={(picked) => {
                      setDay(chosen.type === "since" && picked === today ? null : picked);
                      setPicking(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </Field>

            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              {preview(chosen.type, day, today)}
            </p>
          </DialogPanel>
          <DialogFooter>
            {call.error !== null && (
              <p
                className="me-auto self-center truncate text-xs text-destructive-foreground"
                title={call.error}
              >
                {call.error}
              </p>
            )}
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || call.busy}>
              {call.busy && <Spinner data-icon="inline-start" />}
              Create counter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
