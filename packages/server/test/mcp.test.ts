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
      authorization: `Bearer ${server.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(session === undefined ? {} : { "mcp-session-id": session }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

/** Calls an MCP tool on the workspace and returns its structured result. */
const call = async (name: string, args: Record<string, unknown>) => {
  const response = (await (
    await rpc("tools/call", { name, arguments: { workspace: root, ...args } })
  ).json()) as { result: { structuredContent: unknown; isError?: boolean } };
  expect(response.result.isError ?? false).toBe(false);
  return response.result.structuredContent as Record<string, unknown> &
    Array<Record<string, unknown>>;
};

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-mcp-"));
  root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0 });
  await fetch(`${server.url}/api/workspaces`, {
    method: "POST",
    headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
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
});
