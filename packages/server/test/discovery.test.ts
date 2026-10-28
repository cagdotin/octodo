import { VERSION } from "@octodo/contract/api";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/index.ts";

const scratch = () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-discovery-"));
  return { home: join(base, "home"), base };
};

const serverFile = (home: string) => join(home, "server.json");
const named = (home: string) => JSON.parse(readFileSync(serverFile(home), "utf8"));

describe("server.json", () => {
  it("names the running server's url, pid and version, and is gone once it closes", async () => {
    const { home } = scratch();
    const server = await startServer({ home, port: 0 });
    expect(named(home)).toEqual({ url: server.url, pid: process.pid, version: VERSION });
    expect(await (await fetch(`${server.url}/api/health`)).json()).toMatchObject({
      version: VERSION,
    });
    await server.close();
    expect(existsSync(serverFile(home))).toBe(false);
  });

  it("is left to the server that started last when an earlier one closes", async () => {
    const { home } = scratch();
    const first = await startServer({ home, port: 0 });
    const second = await startServer({ home, port: 0 });
    await first.close();
    expect(named(home).url).toBe(second.url);
    await second.close();
    expect(existsSync(serverFile(home))).toBe(false);
  });
});

describe("the workspace in a path", () => {
  it("is a registered id or an absolute folder, never a relative one", async () => {
    const { home, base } = scratch();
    const root = join(base, "house");
    const deep = join(root, "attic", "a folder name long enough to pass a router limit".repeat(4));
    mkdirSync(deep, { recursive: true });
    const server = await startServer({ home, port: 0 });
    try {
      const add = await fetch(`${server.url}/api/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root, key: "HM" }),
      });
      expect(add.status).toBe(200);
      const overview = async (workspace: string) => {
        const response = await fetch(
          `${server.url}/api/workspaces/${encodeURIComponent(workspace)}/overview`,
        );
        return { status: response.status, body: (await response.json()) as any };
      };
      const byId = await overview("house");
      const byFolder = await overview(deep);
      expect(byFolder).toEqual(byId);
      expect(byId.body.workspace).toMatchObject({ id: "house", root });
      expect(await overview("./house")).toMatchObject({
        status: 400,
        body: { _tag: "InvalidRequest" },
      });
    } finally {
      await server.close();
    }
  });
});
