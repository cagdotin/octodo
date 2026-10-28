import { addDays, format, nextMonday, parseISO } from "date-fns";
import {
  BellIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  ClockIcon,
  MoonIcon,
  RepeatIcon,
  SunIcon,
  SunriseIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@octodo/ui/components/button";
import { Calendar } from "@octodo/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@octodo/ui/components/popover";
import { Separator } from "@octodo/ui/components/separator";
import { ToggleGroup, ToggleGroupItem } from "@octodo/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@octodo/ui/components/tooltip";

const dayKey = (date: Date) => format(date, "yyyy-MM-dd");

/** One-click dates above the calendar; picking one applies it and closes the popover. */
const QUICK: ReadonlyArray<{ label: string; icon: LucideIcon; date: () => Date }> = [
  { label: "Today", icon: SunIcon, date: () => new Date() },
  { label: "Tomorrow", icon: SunriseIcon, date: () => addDays(new Date(), 1) },
  { label: "In 7 days", icon: CalendarPlusIcon, date: () => addDays(new Date(), 7) },
  { label: "Next Monday", icon: MoonIcon, date: () => nextMonday(new Date()) },
];

/** Not built yet: shown so the popover has its final shape, but disabled. */
const LATER: ReadonlyArray<{ label: string; icon: LucideIcon }> = [
  { label: "Time", icon: ClockIcon },
  { label: "Reminder", icon: BellIcon },
  { label: "Repeat", icon: RepeatIcon },
];

/**
 * The due-date popover shared by the add-task box and the task panel: Date / Duration tabs, quick
 * picks, a month calendar, then Clear and OK. A day picked in the calendar is a draft until OK;
 * the quick picks and Clear apply at once. `value` and `onChange` use the frontmatter form,
 * `yyyy-MM-dd`, or null for no date.
 */
export function DuePicker({
  value,
  onChange,
  children,
  align = "start",
  defaultOpen = false,
  onOpenChange,
  onCloseAutoFocus,
}: {
  value: string | null;
  onChange: (due: string | null) => void;
  /** The trigger, rendered as the popover's anchor. */
  children: ReactNode;
  align?: "start" | "center" | "end";
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where focus goes on close; call `preventDefault` to keep it off the trigger. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<string | null>(value);
  const setOpenState = (next: boolean) => {
    if (next) setDraft(value);
    setOpen(next);
    onOpenChange?.(next);
  };
  const apply = (due: string | null) => {
    if (due !== value) onChange(due);
    setOpenState(false);
  };
  const selected = draft ? parseISO(draft) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-68 gap-2 p-2"
        align={align}
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <ToggleGroup
          type="single"
          value="date"
          variant="outline"
          size="sm"
          spacing={0}
          className="w-full"
        >
          <ToggleGroupItem value="date" className="flex-1">
            Date
          </ToggleGroupItem>
          <ToggleGroupItem value="duration" className="flex-1" disabled>
            Duration
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex justify-around">
          {QUICK.map(({ label, icon: Icon, date }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={label}
                  className="text-muted-foreground"
                  onClick={() => apply(dayKey(date()))}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <Calendar
          mode="single"
          required
          className="mx-auto p-0 [--cell-size:--spacing(8)]"
          selected={selected}
          {...(selected ? { defaultMonth: selected } : {})}
          onSelect={(date) => setDraft(dayKey(date))}
        />
        <Separator />
        <div className="flex flex-col">
          {LATER.map(({ label, icon: Icon }) => (
            <Button key={label} variant="ghost" size="sm" className="justify-start" disabled>
              <Icon data-icon="inline-start" />
              {label}
              <ChevronRightIcon data-icon="inline-end" className="ml-auto" />
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => apply(null)}>
            Clear
          </Button>
          <Button size="sm" onClick={() => apply(draft)}>
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
