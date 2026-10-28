import { NodeServices } from "@effect/platform-node";
import { VERSION } from "@octodo/contract/api";
import { makeRegistry } from "@octodo/engine";
import { Effect, Option } from "effect";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connect, findServer } from "../src/index.ts";

const registry = makeRegistry([]);
const servers: Array<Server> = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

/** A scratch home with a workspace `house` registered in it. */
const scratch = async () => {
  const base = mkdtempSync(join(tmpdir(), "octodo-connect-"));
  const home = join(base, "home");
  const root = join(base, "house");
  mkdirSync(root);
  await run(home, (connection) => connection.run("add_workspace", { root, key: "HM" }));
  return { home, root };
};

const run = <A, E>(
  home: string,
  use: (connection: Effect.Success<ReturnType<typeof connect>>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    connect({ home, registry, watch: false }).pipe(
      Effect.flatMap(use),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  );

const tasks = (home: string, root: string) =>
  run(home, (connection) => connection.run("list_tasks", { workspace: root, all: true }));

const failure = (home: string, root: string) =>
  run(home, (connection) => Effect.flip(connection.run("list_tasks", { workspace: root })));

const nameServer = (home: string, url: string, pid = process.pid) =>
  writeFileSync(join(home, "server.json"), JSON.stringify({ url, pid, version: VERSION }));

/** A stand-in server on a free port, answering every request with `answer`. */
const fake = async (answer: (path: string) => { status: number; body: unknown } | null) => {
  const server = createServer((request, response) => {
    const reply = answer(request.url!);
    if (reply === null) return; // hangs
    response.writeHead(reply.status, { "content-type": "application/json" });
    response.end(JSON.stringify(reply.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const SERVED = {
  id: "SV-1",
  title: "From the server",
  status: "todo",
  list: null,
  parent: null,
  priority: "none",
  tags: [],
  due: null,
  blocked: false,
  ready: true,
};

const health = { version: VERSION, capabilities: { operations: true, mcp: true, openapi: true } };

describe("connect", () => {
  it("runs the engine in-process when no server.json names a server", async () => {
    const { home, root } = await scratch();
    await run(home, (connection) => connection.run("create_task", { workspace: root, title: "A" }));
    expect(await tasks(home, root)).toMatchObject([{ id: "HM-1", title: "A" }]);
  });

  it("runs the engine in-process when the named server's process is gone or nothing listens", async () => {
    const { home, root } = await scratch();
    nameServer(home, await fake(() => ({ status: 200, body: health })), 2 ** 22 + 1);
    expect(await tasks(home, root)).toEqual([]);
    const closed = await fake(() => null);
    servers.pop()!.close();
    nameServer(home, closed);
    expect(await tasks(home, root)).toEqual([]);
  });

  it("sends every call to a server that answers as this version does", async () => {
    const { home, root } = await scratch();
    const paths: Array<string> = [];
    nameServer(
      home,
      await fake((path) => {
        paths.push(path);
        return path === "/api/health"
          ? { status: 200, body: health }
          : { status: 200, body: [SERVED] };
      }),
    );
    expect(await tasks(home, root)).toEqual([SERVED]);
    expect(paths).toEqual([
      "/api/health",
      `/api/workspaces/${encodeURIComponent(root)}/tasks?all=true`,
    ]);
  });

  it("gives back the error the server answers with as the engine's own", async () => {
    const { home, root } = await scratch();
    nameServer(
      home,
      await fake((path) =>
        path === "/api/health"
          ? { status: 200, body: health }
          : {
              status: 404,
              body: {
                _tag: "WorkspaceNotFound",
                workspace: "x",
                message: "No workspace found for x",
              },
            },
      ),
    );
    const error = await failure(home, root);
    expect(error._tag).toBe("WorkspaceNotFound");
    expect(error.message).toBe("No workspace found for x");
  });

  it("reports a server of another version, and one that does not answer, without writing behind it", async () => {
    const { home, root } = await scratch();
    nameServer(home, await fake(() => ({ status: 200, body: { ...health, version: "0.9.0" } })));
    expect(await failure(home, root)).toMatchObject({
      _tag: "ServerMismatch",
      version: "0.9.0",
      expected: VERSION,
    });
    const stuck = await fake(() => null);
    nameServer(home, stuck);
    const error = await failure(home, root);
    expect(error._tag).toBe("ServerUnavailable");
    expect(error.message).toBe(
      `The octodo server at ${stuck} (pid ${process.pid}) does not answer within 2 s. Stop it, or wait for it to answer.`,
    );
  });
});

describe("a call through a connection", () => {
  const BIG = 20 * 1024 * 1024 + 1;

  /** A server of this version whose every other route answers with a file of `size` bytes. */
  const fileServer = async (size: number, declared: boolean) => {
    const server = createServer((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(200, { "content-type": "application/json" });
        return response.end(JSON.stringify(health));
      }
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-location": "file:///big.bin",
        ...(declared ? { "content-length": String(size) } : {}),
      });
      response.end(Buffer.alloc(size));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  it("refuses a path parameter no URL can carry, the same with a server or without", async () => {
    const { home, root } = await scratch();
    const refusals = () =>
      run(home, (connection) =>
        Effect.forEach(
          [
            connection.run("delete_task", { workspace: root, id: ".." }),
            connection.run("get_task", { workspace: root, id: "." }),
            connection.run("disable_plugin", { workspace: root, plugin: "" }),
            connection.removeWorkspace(".."),
          ],
          (call) => Effect.map(Effect.flip(call), ({ _tag, message }) => ({ _tag, message })),
        ),
      );
    const expected = [
      { _tag: "InvalidRequest", message: 'The id cannot be ".."' },
      { _tag: "InvalidRequest", message: 'The id cannot be "."' },
      { _tag: "InvalidRequest", message: 'The plugin cannot be ""' },
      { _tag: "InvalidRequest", message: 'The workspace cannot be ".."' },
    ];
    expect(await refusals()).toEqual(expected);
    const paths: Array<string> = [];
    nameServer(
      home,
      await fake((path) => {
        paths.push(path);
        return { status: 200, body: health };
      }),
    );
    expect(await refusals()).toEqual(expected);
    expect(paths).toEqual([]);
  });

  it("refuses an attachment over the limit from a server, as declared or as read", async () => {
    const { home, root } = await scratch();
    for (const declared of [true, false]) {
      nameServer(home, await fileServer(BIG, declared));
      const error = await run(home, (connection) =>
        Effect.flip(
          connection.run("read_attachment", { workspace: root, id: "HM-1", path: "big.bin" }),
        ),
      );
      expect(error).toMatchObject({ _tag: "AttachmentTooLarge", path: "big.bin" });
      expect(error.message).toBe("big.bin is 21 MB; attachments are limited to 20 MB");
    }
  });
});

describe("findServer", () => {
  const find = (home: string) =>
    Effect.runPromise(
      findServer(home).pipe(
        Effect.map(Option.getOrNull),
        Effect.catch((error) => Effect.succeed(error._tag)),
        Effect.provide(NodeServices.layer),
      ),
    );

  it("names the server that answers as this version, nothing when none runs, and reports one that cannot be used", async () => {
    const { home } = await scratch();
    expect(await find(home)).toBeNull();
    const url = await fake(() => ({ status: 200, body: health }));
    nameServer(home, url);
    expect(await find(home)).toEqual({ url, pid: process.pid, version: VERSION });
    nameServer(home, url, 2 ** 22 + 1);
    expect(await find(home)).toBeNull();
    nameServer(home, await fake(() => ({ status: 200, body: { ...health, version: "0.9.0" } })));
    expect(await find(home)).toBe("ServerMismatch");
  });
});
