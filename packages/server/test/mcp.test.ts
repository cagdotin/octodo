import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/index.ts";

let server: RunningServer;
let root: string;
let session: string;

const rpc = (method: string, params: unknown) =>
  fetch(`${server.url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session === undefined ? {} : { "mcp-session-id": session }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

type Result = Record<string, unknown> & Array<Record<string, unknown>>;

/** Calls an MCP tool on the workspace and returns whether it failed and what it returned. */
const attempt = async (name: string, args: Record<string, unknown>) => {
  const { result } = (await (
    await rpc("tools/call", { name, arguments: { workspace: root, ...args } })
  ).json()) as {
    result: {
      structuredContent?: unknown;
      content: Array<{ text: string }>;
      isError?: boolean;
    };
  };
  // Structured content is an object only, so a list comes back as text alone.
  const value = result.structuredContent ?? JSON.parse(result.content[0]!.text);
  return { isError: result.isError ?? false, value: value as Result };
};

const call = async (name: string, args: Record<string, unknown>) => {
  const { isError, value } = await attempt(name, args);
  expect(isError).toBe(false);
  return value;
};

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-mcp-"));
  root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0 });
  await fetch(`${server.url}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root }),
  });
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  session = initialized.headers.get("mcp-session-id")!;
});

afterAll(() => server.close());

describe("task links over MCP", () => {
  it("returns blockers as id, title and status from update_task, as get_task does", async () => {
    const primer = await call("create_task", { title: "Buy primer" });
    const paint = await call("create_task", { title: "Paint" });
    const updated = await call("update_task", { id: paint["id"], blocked_by: [primer["id"]] });
    const read = await call("get_task", { id: paint["id"] });
    const ref = { id: primer["id"], title: "Buy primer", status: "todo" };
    expect(updated["blockedBy"]).toEqual([ref]);
    expect(updated).toEqual(read);
  });

  it("lists only open, unblocked tasks as ready, and refuses a blocker that matches no task", async () => {
    const tile = await call("create_task", { title: "Tile" });
    const grout = await call("create_task", { title: "Grout" });
    await call("update_task", { id: grout["id"], blocked_by: [tile["id"]] });
    const readyIds = async () =>
      (await call("list_tasks", { ready: true })).map((task) => task["id"]);
    expect(await readyIds()).toContain(tile["id"]);
    expect(await readyIds()).not.toContain(grout["id"]);
    const all = await call("list_tasks", {});
    expect(all.find((task) => task["id"] === grout["id"])).toMatchObject({ blocked: true });
    expect((await call("get_task", { id: tile["id"] }))["blocks"]).toEqual([
      { id: grout["id"], title: "Grout", status: "todo" },
    ]);
    await call("move_task", { id: tile["id"], status: "done" });
    expect(await readyIds()).toContain(grout["id"]);
    expect(await readyIds()).not.toContain(tile["id"]);
    const unknown = await attempt("update_task", { id: grout["id"], blocked_by: ["HOU-404"] });
    expect(unknown.isError).toBe(true);
  });
});
