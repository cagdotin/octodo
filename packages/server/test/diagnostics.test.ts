import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/index.ts";

let server: RunningServer;
let root: string;
let base: string;

const post = (path: string, body?: unknown, token: string | null = server.token) =>
  fetch(`${server.url}${base}${path}`, {
    method: "POST",
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const seed = (file: string, content: string) => {
  const target = join(root, ".octodo", file);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
};

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-server-"));
  root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0 });
  const response = await fetch(`${server.url}/api/workspaces`, {
    method: "POST",
    headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
    body: JSON.stringify({ root }),
  });
  base = `/api/workspaces/${((await response.json()) as { id: string }).id}`;
});

afterAll(() => server.close());

describe("fixing diagnostics over HTTP", () => {
  it("fixes one problem by path, kind and action, and a repeat finds nothing to fix", async () => {
    seed("HOU-1-a/task.md", "---\nid: HOU-1\n---\n");
    seed("HOU-1-b/task.md", "---\nid: HOU-1\n---\n");
    const request = {
      path: ".octodo/HOU-1-b/task.md",
      kind: "duplicate-id",
      action: "fresh-id",
    };
    const first = (await (await post("/diagnostics/fix", request)).json()) as {
      fixed: Array<{ kind: string }>;
      diagnostics: Array<unknown>;
    };
    expect(first.fixed.map((diagnostic) => diagnostic.kind)).toEqual(["duplicate-id"]);
    expect(first.diagnostics).toEqual([]);
    expect(readFileSync(join(root, ".octodo/HOU-2-b/task.md"), "utf8")).toBe(
      "---\nid: HOU-2\n---\n",
    );
    const again = (await (await post("/diagnostics/fix", request)).json()) as { fixed: [] };
    expect(again.fixed).toEqual([]);
  });

  it("fixes everything fixable in one call", async () => {
    seed("HOU-1-a/task 2.md", "---\nid: HOU-1\n---\n");
    seed("notes.md", "---\ntitle: Loose\n---\n");
    const result = (await (await post("/diagnostics/fix-all")).json()) as {
      fixed: Array<{ kind: string }>;
    };
    expect(result.fixed.map((diagnostic) => diagnostic.kind)).toEqual(["conflict-copy"]);
    expect(readFileSync(join(root, ".octodo/notes.md"), "utf8")).toBe("---\ntitle: Loose\n---\n");
  });

  it("refuses a workspace key that ids cannot use", async () => {
    const other = join(mkdtempSync(join(tmpdir(), "octodo-server-")), "keyed");
    mkdirSync(other);
    const response = await fetch(`${server.url}/api/workspaces`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
      body: JSON.stringify({ root: other, key: "MY_K" }),
    });
    expect(response.status).toBe(400);
  });

  it("refuses a request without the token or with an unknown kind", async () => {
    expect((await post("/diagnostics/fix-all", undefined, null)).status).toBe(401);
    const bad = await post("/diagnostics/fix", {
      path: ".octodo",
      kind: "everything",
      action: "fresh-id",
    });
    expect(bad.status).toBe(400);
    const actionless = await post("/diagnostics/fix", { path: ".octodo", kind: "duplicate-id" });
    expect(actionless.status).toBe(400);
  });
});
