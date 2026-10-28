import { startServer } from "@octodo/server";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { startBackend, type Problem } from "./backend.ts";

const script = fileURLToPath(new URL("./server.ts", import.meta.url));
const serverFile = (home: string) => join(home, "server.json");
const named = (home: string) =>
  JSON.parse(readFileSync(serverFile(home), "utf8")) as { url: string; pid: number };

/** A backend on a scratch home, recording each server url and problem it reports. */
const launch = (home = join(mkdtempSync(join(tmpdir(), "octodo-desktop-")), "home")) => {
  const urls: Array<string> = [];
  const problems: Array<Problem> = [];
  let answer: (retry: boolean) => void = () => {};
  const backend = startBackend({
    home,
    port: 0,
    webDir: "",
    script,
    onServer: (url) => urls.push(url),
    onProblem: (problem) => {
      problems.push(problem);
      return new Promise((resolve) => (answer = resolve));
    },
  });
  return { home, urls, problems, backend, answer: (retry: boolean) => answer(retry) };
};

const until = async (check: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("the desktop backend", () => {
  it("spawns a server, restarts it after a crash, and stops it so server.json goes", async () => {
    const app = launch();
    await until(() => app.urls.length === 1);
    const first = named(app.home);
    expect(first.url).toBe(app.urls[0]);
    expect(first.pid).not.toBe(process.pid);

    process.kill(first.pid, "SIGKILL");
    await until(() => app.urls.length === 2);
    expect(app.urls[1]).toBe(first.url);
    expect(named(app.home).pid).not.toBe(first.pid);

    await app.backend.stop();
    expect(existsSync(serverFile(app.home))).toBe(false);
    expect(await app.backend.running).toBe(true);
  }, 30_000);

  it("attaches to a running server, leaves it running, and takes over once it stops", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "octodo-desktop-")), "home");
    const server = await startServer({ home, port: 0 });
    const app = launch(home);
    await until(() => app.urls.length === 1);
    expect(app.urls[0]).toBe(server.url);
    expect(named(home).pid).toBe(process.pid);

    await server.close();
    await until(() => app.urls.length === 2);
    expect(named(home).pid).not.toBe(process.pid);
    await app.backend.stop();
    expect(existsSync(serverFile(home))).toBe(false);
  }, 30_000);

  it("shows a server of another version instead of replacing it", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "octodo-desktop-")), "home");
    const other = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: "0.9.0", capabilities: { operations: true } }));
    });
    await new Promise<void>((resolve) => other.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
    mkdirSync(home, { recursive: true });
    writeFileSync(serverFile(home), JSON.stringify({ url, pid: process.pid, version: "0.9.0" }));
    const app = launch(home);
    await until(() => app.problems.length > 0 || app.urls.length > 0);
    expect(app.urls).toEqual([]);
    expect(app.problems[0]?.title).toBe("Another version of octodo is running");

    other.close();
    app.answer(false);
    expect(await app.backend.running).toBe(false);
  }, 30_000);
});
