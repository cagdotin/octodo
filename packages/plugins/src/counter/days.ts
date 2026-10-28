/** Calendar days where the code runs: the engine's on the person's computer, the app's in the browser. */

const dayNumber = (date: Date) =>
  Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);

/** Whole calendar days from the instant `from` to `to`: 0 on the same day, null for a bad instant. */
export const daysBetween = (from: string, to: Date = new Date()): number | null => {
  const start = new Date(from);
  return Number.isNaN(start.getTime()) ? null : dayNumber(to) - dayNumber(start);
};

export const daysText = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;

/** The local day of an instant, `YYYY-MM-DD`. */
export const localDay = (instant: string) => {
  const date = new Date(instant);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
