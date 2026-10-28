/**
 * The desktop app: starts the octodo server (API, MCP endpoint and web app) inside the Electron
 * main process and shows the web app in a window.
 */
import { defaultHome } from "@octodo/engine";
import { DEFAULT_PORT, startServer, type RunningServer } from "@octodo/server";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const devUrl = process.env["OCTODO_DEV_URL"];
const home = defaultHome(process.env, homedir());

let server: RunningServer | undefined;

const webDir = () =>
  app.isPackaged
    ? join(process.resourcesPath, "web")
    : fileURLToPath(new URL("../../web/dist", import.meta.url));

const start = async (): Promise<RunningServer> => {
  const options = { home, webDir: webDir() };
  try {
    return await startServer({
      ...options,
      port: Number(process.env["OCTODO_PORT"] ?? DEFAULT_PORT),
    });
  } catch (error) {
    // Another octodo (e.g. `octo serve`) may hold the usual port; any free port will do then.
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || devUrl !== undefined) throw error;
    return await startServer({ ...options, port: 0 });
  }
};

/**
 * Packaged builds take their icon from the app bundle (build/icon.icns); unpackaged runs would show
 * Electron's, so point the dock and windows at the same artwork.
 */
const devIcon = app.isPackaged
  ? undefined
  : fileURLToPath(new URL("../build/icon.png", import.meta.url));

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

ipcMain.handle("octodo:is-full-screen", (event) =>
  Boolean(BrowserWindow.fromWebContents(event.sender)?.isFullScreen()),
);

/** The native folder picker, as a sheet on the asking window; null when cancelled. */
ipcMain.handle("octodo:pick-folder", async (event, defaultPath: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: "Choose a workspace folder",
    buttonLabel: "Choose",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    ...(typeof defaultPath === "string" ? { defaultPath } : {}),
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

/** Shows a folder in Finder (Explorer, the file manager). Only absolute paths are accepted. */
ipcMain.handle("octodo:show-folder", async (_event, folder: unknown) => {
  if (typeof folder !== "string" || !folder.startsWith("/")) return;
  await shell.openPath(folder);
});

const createWindow = async (running: RunningServer) => {
  const mac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    title: "octodo",
    ...(devIcon !== undefined && !mac ? { icon: devIcon } : {}),
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
  window.on("enter-full-screen", () => window.webContents.send("octodo:full-screen", true));
  window.on("leave-full-screen", () => window.webContents.send("octodo:full-screen", false));

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
  await window.loadURL(base);
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
    if (devIcon !== undefined) app.dock?.setIcon(devIcon);
    server = await start();
    console.log(`octodo server on ${server.url} (MCP at ${server.mcpUrl})`);
    await createWindow(server);
  });
}
