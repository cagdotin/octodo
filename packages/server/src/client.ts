import { hc } from "hono/client";
import type { Api } from "./app.ts";

/** Typed client for the `/api` routes, shared by the web and (later) mobile apps. */
export const createClient = (baseUrl: string, init?: RequestInit) =>
  hc<Api>(`${baseUrl.replace(/\/$/, "")}/api`, { init: { credentials: "include", ...init } });

export type Client = ReturnType<typeof createClient>;
