import { createClient } from "@octodo/contract/client";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/index.ts";

let server: RunningServer;

const JSON_BODY = { "content-type": "application/json" };

const call = (path: string, init: RequestInit = {}) => fetch(`${server.url}${path}`, init);

const titles = async (path: string) =>
  ((await (await call(path)).json()) as Array<{ title: string }>).map(({ title }) => title);

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-requests-"));
  const root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0 });
  await call("/api/workspaces", {
    method: "POST",
    headers: JSON_BODY,
    body: JSON.stringify({ root, key: "HM" }),
  });
  const post = (path: string, body: object) =>
    call(`/api/workspaces/house${path}`, {
      method: "POST",
      headers: JSON_BODY,
      body: JSON.stringify(body),
    });
  await post("/lists", { name: "null" });
  await post("/tasks", { title: "Outside any list" });
  await post("/tasks", { title: "In the list named null", list: "null" });
});

afterAll(() => server.close());

describe("a query value", () => {
  it("is null when empty, and the string null names a list like any other", async () => {
    expect(await titles("/api/workspaces/house/tasks?list=")).toEqual(["Outside any list"]);
    expect(await titles("/api/workspaces/house/tasks?list=null")).toEqual([
      "In the list named null",
    ]);
  });

  it("is sent empty for null by the typed client", async () => {
    const client = createClient(server.url);
    const list = (value: string | null) =>
      client.request("GET /api/workspaces/:workspace/tasks", {
        params: { workspace: "house" },
        query: { list: value },
      });
    expect((await list(null)).map(({ title }) => title)).toEqual(["Outside any list"]);
    expect((await list("null")).map(({ title }) => title)).toEqual(["In the list named null"]);
  });
});

describe("a path parameter", () => {
  it("that a URL cannot carry is refused before the request is sent", async () => {
    const client = createClient(server.url);
    for (const id of ["", ".", ".."])
      await expect(
        client.request("DELETE /api/workspaces/:workspace/tasks/:id", {
          params: { workspace: "house", id },
        }),
      ).rejects.toMatchObject({
        status: 400,
        body: { _tag: "InvalidRequest", message: `The id cannot be ${JSON.stringify(id)}` },
      });
    expect(await titles("/api/workspaces/house/tasks")).toHaveLength(2);
  });
});

describe("a request body", () => {
  it("of a content type the route does not take is refused as JSON", async () => {
    const response = await call("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "x",
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      _tag: "InvalidRequest",
      message: "Unsupported content type text/plain; send application/json",
    });
  });
});
