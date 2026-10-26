import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

export const SESSION_COOKIE = "tasksmd_session";

/**
 * The server's access token, kept in `<home>/server.json` so it survives restarts and paired
 * browsers stay signed in. Created on first start.
 */
export const loadToken = (home: string): string => {
  const file = join(home, "server.json");
  if (existsSync(file)) {
    const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      typeof saved === "object" &&
      saved !== null &&
      "token" in saved &&
      typeof saved.token === "string"
    ) {
      return saved.token;
    }
  }
  const token = randomBytes(32).toString("base64url");
  mkdirSync(home, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 });
  return token;
};

export const tokenMatches = (expected: string, given: string | undefined): boolean => {
  if (given === undefined) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

/**
 * Accepts requests addressed to loopback, an IP address or a configured host name (such as a
 * Tailscale MagicDNS name). Rejecting other Host headers stops DNS-rebinding pages from reaching
 * the server under a name they control. `*` turns the check off.
 */
export const hostGuard = (allowedHosts: ReadonlyArray<string>): MiddlewareHandler => {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  return async (c, next) => {
    const host = hostname(c.req.header("host") ?? "");
    if (allowed.has("*") || LOOPBACK.has(host) || IP_LITERAL.test(host) || allowed.has(host))
      return next();
    return c.json({ error: `Host ${host} is not allowed; add it with --allow-host` }, 403);
  };
};

/** Requires the token as a bearer header (agents, CLI) or the session cookie set by pairing (browsers). */
export const requireToken =
  (token: string): MiddlewareHandler =>
  async (c, next) => {
    const header = c.req.header("authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (tokenMatches(token, bearer) || tokenMatches(token, getCookie(c, SESSION_COOKIE))) {
      // A cookie rides along on cross-site requests; refuse writes whose Origin is another site.
      const origin = c.req.header("origin");
      if (bearer === undefined && origin !== undefined && c.req.method !== "GET") {
        const originHost = URL.canParse(origin) ? new URL(origin).host : "";
        if (originHost !== c.req.header("host"))
          return c.json({ error: "Cross-origin request refused" }, 403);
      }
      return next();
    }
    return c.json({ error: "Not paired: open the pairing link shown by tasksmd" }, 401);
  };
