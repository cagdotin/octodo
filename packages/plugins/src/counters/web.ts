import type { SectionWeb } from "../web.ts";
import { counterDay, type CounterFields } from "./count.ts";

/** The counters section's web half: the day Today and Next 7 days list a yearly counter on. */
export const countersWeb: SectionWeb<CounterFields> = { day: counterDay };
