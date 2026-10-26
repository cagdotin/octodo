/**
 * The desktop app: starts the tasksmd server (API, MCP endpoint and web app) inside the Electron
 * main process and shows the web app in a window. The same server stays reachable from a browser,
 * so a phone on the tailnet can use it while the app is open.
 */
import { defaultHome } from "@tasksmd/core";
import { DEFAULT_PORT, startServer, type RunningServer } from "@tasksmd/server";
import { BrowserWindow, app, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const devUrl = process.env["TASKSMD_DEV_URL"];
const home = defaultHome(process.env, homedir());

let server: RunningServer | undefined;

const webDir = () =>
  app.isPackaged
    ? join(process.resourcesPath, "web")
    : fileURLToPath(new URL("../../web/dist", import.meta.url));

const start = async (): Promise<RunningServer> => {
  const options = {
    home,
    host: process.env["TASKSMD_HOST"] ?? "127.0.0.1",
    webDir: webDir(),
    allowedHosts: (process.env["TASKSMD_ALLOW_HOSTS"] ?? "")
      .split(",")
      .filter((host) => host.length > 0),
  };
  try {
    return await startServer({
      ...options,
      port: Number(process.env["TASKSMD_PORT"] ?? DEFAULT_PORT),
    });
  } catch (error) {
    // Another tasksmd (e.g. `tasksmd serve`) may hold the usual port; any free port will do then.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || devUrl !== undefined) throw error;
    return await startServer({ ...options, port: 0 });
  }
};

/** In development the window loads Vite, which proxies to this server; wait until Vite is up. */
const waitFor = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
};

/**
 * On macOS the web app draws its own title bar: a 52px strip at the top of the sidebar (and the
 * main card's header beside it) is a drag region, and the traffic lights sit centred in it. Keep
 * these numbers in step with the `desktop-mac` styles in apps/web.
 */
const trafficLightPosition = { x: 16, y: 18 };

ipcMain.handle("tasksmd:is-full-screen", (event) =>
  Boolean(BrowserWindow.fromWebContents(event.sender)?.isFullScreen()),
);

const createWindow = async (running: RunningServer) => {
  const mac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    title: "tasksmd",
    ...(mac ? { titleBarStyle: "hidden" as const, trafficLightPosition } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  window.once("ready-to-show", () => window.show());

  // The traffic lights disappear in full screen, so the web app drops the room it keeps for them.
  window.on("enter-full-screen", () => window.webContents.send("tasksmd:full-screen", true));
  window.on("leave-full-screen", () => window.webContents.send("tasksmd:full-screen", false));

  // Links to other sites open in the default browser, never inside the app window.
  const origin = new URL(devUrl ?? running.url).origin;
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  const base = devUrl ?? running.url;
  if (devUrl !== undefined) await waitFor(devUrl);
  await window.loadURL(`${base}/api/pair?token=${encodeURIComponent(running.token)}&next=/`);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && server !== undefined)
      void createWindow(server);
  });

  let closing = false;
  app.on("before-quit", (event) => {
    if (server === undefined || closing) return;
    closing = true;
    event.preventDefault();
    void server.close().finally(() => app.quit());
  });

  void app.whenReady().then(async () => {
    server = await start();
    console.log(`tasksmd server on ${server.url} (MCP at ${server.mcpUrl})`);
    await createWindow(server);
  });
}
