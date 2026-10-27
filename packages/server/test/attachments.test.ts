import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type RunningServer } from "../src/index.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const JSON_BODY = { "content-type": "application/json" };

let server: RunningServer;
let root: string;
let files: string;
let taskFolder: string;

const call = (
  path: string,
  init: Omit<RequestInit, "headers"> & {
    headers?: Record<string, string>;
    token?: string | null;
  } = {},
) => {
  const { token = server.token, headers, ...rest } = init;
  return fetch(`${server.url}${path}`, {
    ...rest,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...headers },
  });
};

/** A GET with the path sent as is; fetch would resolve `..` segments before sending. */
const rawGet = (path: string) =>
  new Promise<number>((resolve, reject) => {
    const url = new URL(server.url);
    request(
      {
        host: url.hostname,
        port: url.port,
        path,
        headers: { authorization: `Bearer ${server.token}` },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    )
      .on("error", reject)
      .end();
  });

beforeAll(async () => {
  const scratch = mkdtempSync(join(tmpdir(), "octodo-server-"));
  root = join(scratch, "house");
  mkdirSync(root);
  server = await startServer({ home: join(scratch, "home"), port: 0 });
  const workspace = (await (
    await call("/api/workspaces", {
      method: "POST",
      headers: JSON_BODY,
      body: JSON.stringify({ root }),
    })
  ).json()) as { id: string };
  const task = (await (
    await call(`/api/workspaces/${workspace.id}/tasks`, {
      method: "POST",
      headers: JSON_BODY,
      body: JSON.stringify({ title: "Paint the hall" }),
    })
  ).json()) as { id: string; path: string };
  files = `/api/workspaces/${workspace.id}/tasks/${task.id}/files`;
  taskFolder = dirname(join(root, task.path));
});

afterAll(() => server.close());

describe("task attachments over HTTP", () => {
  it("saves an upload in the task folder and serves it back as an image", async () => {
    const put = await call(`${files}/images/hall.png`, { method: "PUT", body: PNG });
    expect(await put.json()).toEqual({ path: "images/hall.png" });
    expect(new Uint8Array(readFileSync(join(taskFolder, "images", "hall.png")))).toEqual(PNG);

    const get = await call(`${files}/images/hall.png`);
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    expect(get.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(PNG);
  });

  it("gives a second upload with the same name a free one", async () => {
    const put = await call(`${files}/images/twice.png`, { method: "PUT", body: PNG });
    const again = await call(`${files}/images/twice.png`, { method: "PUT", body: PNG });
    expect(await put.json()).toEqual({ path: "images/twice.png" });
    expect(await again.json()).toEqual({ path: "images/twice-2.png" });
    expect(readdirSync(join(taskFolder, "images"))).toContain("twice-2.png");
  });

  it("serves and saves files at the top of the task folder", async () => {
    const put = await call(`${files}/notes.txt`, { method: "PUT", body: "one" });
    const again = await call(`${files}/notes.txt`, { method: "PUT", body: "two" });
    expect(await put.json()).toEqual({ path: "notes.txt" });
    expect(await again.json()).toEqual({ path: "notes-2.txt" });
    const get = await call(`${files}/notes.txt`);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe("one");
  });

  it("refuses a symlinked folder that points out of the task folder", async () => {
    const outside = mkdtempSync(join(tmpdir(), "octodo-outside-"));
    symlinkSync(outside, join(taskFolder, "linked"));
    expect((await call(`${files}/linked/x.png`, { method: "PUT", body: PNG })).status).toBe(400);
    expect(readdirSync(outside)).toEqual([]);
    expect((await call(`${files}/linked/x.png`)).status).toBe(400);
  });

  it("refuses an upload that would make a subtask", async () => {
    for (const path of ["newsub/task.md", "TASK.MD"]) {
      const put = await call(`${files}/${path}`, { method: "PUT", body: "---\ntitle: x\n---\n" });
      expect({ path, status: put.status }).toEqual({ path, status: 400 });
    }
    expect(existsSync(join(taskFolder, "newsub"))).toBe(false);
  });

  it("needs the token", async () => {
    expect((await call(`${files}/images/hall.png`, { token: null })).status).toBe(401);
    expect((await call(`${files}/x.png`, { method: "PUT", body: PNG, token: null })).status).toBe(
      401,
    );
  });

  it("refuses paths that leave the task folder or name the task file", async () => {
    expect(await rawGet(`${files}/../../../config.json`), "resolved away by URL parsing").toBe(404);
    expect(await rawGet(`${files}/images/..%2F..%2Ftask.md`)).toBe(400);
    expect((await call(`${files}/task.md`)).status).toBe(400);
    expect((await call(`${files}/.hidden`, { method: "PUT", body: PNG })).status).toBe(400);
  });

  it("answers 404 for a missing file and refuses an upload over the size cap", async () => {
    expect((await call(`${files}/images/none.png`)).status).toBe(404);
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    expect((await call(`${files}/images/big.png`, { method: "PUT", body: big })).status).toBe(413);
  });

  it("refuses a cookie-carrying upload from another origin", async () => {
    const put = await call(`${files}/images/csrf.png`, {
      method: "PUT",
      body: PNG,
      token: null,
      headers: { cookie: `octodo_session=${server.token}`, origin: "https://evil.example" },
    });
    expect(put.status).toBe(403);
  });
});
