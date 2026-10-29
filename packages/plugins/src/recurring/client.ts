import type { ServedApi } from "@octodo/contract/api";
import { createClient } from "@octodo/contract/client";
import type { recurringShared } from "./shared.ts";

export const api = createClient<ServedApi<typeof recurringShared.operations>>("");
