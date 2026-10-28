import { VERSION } from "@octodo/contract/api";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("names one server: a second one started with it is refused, and starts once the first closes", async () => {
    const { home } = scratch();
    const started = await Promise.allSettled([
      startServer({ home, port: 0 }),
      startServer({ home, port: 0 }),
    ]);
    const running = started.flatMap((each) => (each.status === "fulfilled" ? [each.value] : []));
    expect(running).toHaveLength(1);
    expect(started.find((each) => each.status === "rejected")).toMatchObject({
      reason: {
        code: "OCTODO_HOME_TAKEN",
        message: `Another octodo server runs for ${home}. Use it, or stop it first.`,
      },
    });
    expect(named(home).url).toBe(running[0]!.url);
    await running[0]!.close();
    const next = await startServer({ home, port: 0 });
    expect(named(home).url).toBe(next.url);
    await next.close();
    expect(existsSync(serverFile(home))).toBe(false);
  });

  it("is replaced by the next server when the one it names is gone", async () => {
    const { home } = scratch();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      serverFile(home),
      JSON.stringify({ url: "http://127.0.0.1:1", pid: 2 ** 22 + 1, version: VERSION }),
    );
    const server = await startServer({ home, port: 0 });
    expect(named(home)).toEqual({ url: server.url, pid: process.pid, version: VERSION });
    await server.close();
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
