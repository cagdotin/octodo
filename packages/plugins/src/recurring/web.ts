import { RepeatIcon } from "lucide-react";
import type { PluginWeb } from "../web.ts";
import { api } from "./client.ts";
import { dueDay, parseRule } from "./rule.ts";
import type { RecurringFields } from "./shared.ts";
import { CreateFields, type Draft, Panel, Row } from "./views.tsx";

export const recurringWeb: PluginWeb<RecurringFields, Draft> = {
  Row,
  Panel,
  day: dueDay,
  completesInPlace: true,
  create: {
    noun: "Recurring task",
    Icon: RepeatIcon,
    empty: { repeat: "" },
    Fields: CreateFields,
    ready: ({ repeat }) => repeat.trim() !== "" && !("error" in parseRule(repeat)),
    create: (workspace, task, { repeat }) =>
      api.request("POST /api/workspaces/:workspace/recurring", {
        params: { workspace },
        payload: { ...task, repeat },
      }),
  },
};
