import { Calendar } from "@octodo/ui/components/calendar";
import { useToday } from "@octodo/ui/hooks/use-today";
import { format, parseISO } from "date-fns";
import { TimerIcon } from "lucide-react";
import { KIND } from "./common.ts";
import type { CounterFields, CounterType } from "./count.ts";

/** A counter's kind's icon; the section's own for a counter whose type is unreadable. */
export function KindIcon({
  type,
  className,
}: {
  type: CounterType | null;
  className?: string | undefined;
}) {
  const Icon = type === null ? TimerIcon : KIND[type].Icon;
  return <Icon aria-label={type === null ? "Counter" : KIND[type].label} className={className} />;
}

/**
 * A day picker with month and year menus, to reach a birthday in 1961. `past` keeps it to today and
 * before, for when something last happened.
 */
export function DayCalendar({
  value,
  onPick,
  past = false,
}: {
  value: string | null;
  onPick: (day: string) => void;
  past?: boolean;
}) {
  const today = parseISO(useToday());
  const selected = value === null ? today : parseISO(value);
  return (
    <Calendar
      mode="single"
      captionLayout="dropdown"
      startMonth={new Date(1900, 0)}
      endMonth={past ? today : new Date(today.getFullYear() + 10, 11)}
      defaultMonth={selected}
      {...(past ? { disabled: { after: today } } : {})}
      {...(value === null ? {} : { selected })}
      onSelect={(date) => date && onPick(format(date, "yyyy-MM-dd"))}
    />
  );
}

/** A counter's icon in the section's lists. */
export function CounterIcon({
  fields,
  className,
}: {
  readonly fields: CounterFields;
  readonly className?: string;
}) {
  return <KindIcon type={fields.type} className={className} />;
}
