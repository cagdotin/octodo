import { CalendarClockIcon, TimerIcon } from "lucide-react";
import type { SectionWeb } from "../web.ts";
import { api, KIND, remove } from "./common.ts";
import { CounterIcon } from "./parts.tsx";
import { countOf, counterDay, type CounterFields } from "./count.ts";
import { Panel } from "./panel.tsx";
import { View } from "./view.tsx";

/** How far ahead "Coming up" looks. */
const SOON = 30;

/** The counters section's web half (decision 0027). */
export const countersWeb: SectionWeb<CounterFields> = {
  label: "Counters",
  noun: "counter",
  Icon: TimerIcon,
  EntryIcon: CounterIcon,
  views: [
    {
      id: "soon",
      label: `Next ${SOON} days`,
      Icon: CalendarClockIcon,
      matches: (fields, today) => {
        const count = countOf(fields, today);
        return count !== null && "next" in count && count.daysUntil <= SOON;
      },
    },
    { id: "yearly", ...KIND.yearly, matches: (fields) => fields.type === "yearly" },
    { id: "since", ...KIND.since, matches: (fields) => fields.type === "since" },
  ],
  View,
  Panel,
  edit: (workspace, id, patch) =>
    api.request("PATCH /api/workspaces/:workspace/counters/:id", {
      params: { workspace, id },
      payload: patch,
    }),
  remove,
  day: counterDay,
};
