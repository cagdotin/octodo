/** A calendar day as the plugins take one, `YYYY-MM-DD`. Plain, so every client runs it. */

/** `value` as a day that exists, or why it is not one. */
export const readDay = (value: unknown): { readonly day: string } | { readonly error: string } => {
  const text = typeof value === "string" ? value.trim() : value;
  const parts = typeof text === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null;
  if (parts === null)
    return { error: `The date ${JSON.stringify(value)} is not a day written YYYY-MM-DD` };
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return { error: `The date ${text} is not a day the calendar has` };
  return { day: parts[0] };
};
