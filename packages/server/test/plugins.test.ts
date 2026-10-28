import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tally } from "../../plugins/test/tally/engine.ts";
import { startServer, type RunningServer } from "../src/index.ts";

let server: RunningServer;
let root: string;
let base: string;

const post = (path: string, body: unknown = {}) =>
  fetch(`${server.url}${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const enable = (...ids: Array<string>) => {
  const config = join(root, ".octodo", "config.json");
  writeFileSync(
    config,
    JSON.stringify({ ...JSON.parse(readFileSync(config, "utf8")), plugins: ids }),
  );
};

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-server-"));
  root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0, plugins: [tally] });
  const response = await fetch(`${server.url}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ root }),
  });
  base = `/api/workspaces/${((await response.json()) as { id: string }).id}`;
});

afterAll(() => server.close());

describe("plugin operations over HTTP", () => {
  it("serves a plugin's operations at its paths, refused with 409 until the workspace enables it", async () => {
    const refused = await post("/tallies", { title: "Water", step: 2 });
    expect(refused.status, "a plugin the workspace does not enable is a conflict").toBe(409);
    expect(await refused.json()).toMatchObject({ _tag: "PluginNotEnabled", plugin: "tally" });

    enable("tally");
    await vi.waitFor(async () => {
      const snapshot = (await (await fetch(`${server.url}${base}`)).json()) as {
        plugins?: unknown;
      };
      expect(snapshot.plugins, "the watcher has seen config.json").toEqual(["tally"]);
    });
    const created = await post("/tallies", { title: "Water", step: 2 });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const bumped = await post(`/tallies/${id}/bump`);
    expect(bumped.status).toBe(200);
    expect(await bumped.json()).toMatchObject({ id, kind: { id: "tally", fields: { count: 2 } } });
  });
});
